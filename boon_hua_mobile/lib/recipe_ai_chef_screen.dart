import 'dart:async';

import 'package:flutter/material.dart';

import 'api_config.dart';
import 'recipe_ai_service.dart';
import 'theme/app_colors.dart';
import 'recipe_chat_history.dart';

class RecipeAiChefScreen extends StatefulWidget {
  const RecipeAiChefScreen({
    super.key,
    required this.userId,
    required this.freezerItems,
  });

  final String userId;
  final List<FreezerItemPayload> freezerItems;

  @override
  State<RecipeAiChefScreen> createState() => _RecipeAiChefScreenState();
}

class _RecipeAiChefScreenState extends State<RecipeAiChefScreen> {
  final _service = RecipeAiService();
  final _input = TextEditingController();
  final _scroll = ScrollController();
  late final RecipeChatHistoryStore _historyStore;
  final List<_UiMessage> _messages = [];
  bool _sending = false;
  bool _loadingHistory = true;
  int _cooldownSeconds = 0;
  Timer? _cooldownTimer;
  RecipeAiAvailability _availability = RecipeAiAvailability.unknown;

  static const _welcome = _UiMessage(
    role: 'assistant',
    text:
        'Hi! I am your AI cooking assistant for recipes and seafood meals only. '
        'Ask what to cook, how to prepare freezer items, or ingredient substitutions.',
    localOnly: true,
  );

  static const _starters = [
    'What should I cook tonight with what I have?',
    'Give me a quick recipe using my fish that expires soon.',
    'What extra ingredients do I need for a simple stir-fry?',
  ];

  @override
  void initState() {
    super.initState();
    _historyStore = RecipeChatHistoryStore(widget.userId);
    _checkAi();
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    try {
      final saved = await _historyStore
          .load()
          .timeout(const Duration(seconds: 12), onTimeout: () => []);
      if (!mounted) return;
      setState(() {
        _messages.clear();
        if (saved.isEmpty) {
          _messages.add(_welcome);
        } else {
          for (final row in saved) {
            _messages.add(
              _UiMessage(
                role: row.role,
                text: row.text,
                recipes: row.recipes,
                isError: row.isError,
              ),
            );
          }
        }
        _loadingHistory = false;
      });
      _scrollToEnd();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _messages.add(_welcome);
        _loadingHistory = false;
      });
    }
  }

  Future<void> _clearHistory() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Clear chat history?'),
        content: const Text(
          'This removes all saved messages from your account. You cannot undo this.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Clear'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    await _historyStore.clearAll();
    if (!mounted) return;
    setState(() {
      _messages
        ..clear()
        ..add(_welcome);
    });
  }

  Future<void> _checkAi() async {
    await ApiConfig.syncRemoteConfig();
    final availability = await _service.checkAvailability();
    if (!mounted) return;
    setState(() => _availability = availability);
  }

  void _startCooldown(int seconds) {
    _cooldownTimer?.cancel();
    setState(() => _cooldownSeconds = seconds.clamp(1, 120));
    _cooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_cooldownSeconds <= 1) {
        setState(() => _cooldownSeconds = 0);
        timer.cancel();
      } else {
        setState(() => _cooldownSeconds -= 1);
      }
    });
  }

  /// Typing is allowed while history loads; only sending waits for readiness.
  bool get _canType => !_sending && _cooldownSeconds <= 0;

  bool get _canSend => _canType && !_loadingHistory && _availability.apiReachable;

  @override
  void dispose() {
    _cooldownTimer?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  List<RecipeChatMessage> _historyForApi() {
    return _messages
        .where((m) => !m.localOnly && (m.role == 'user' || m.role == 'assistant'))
        .map((m) => RecipeChatMessage(role: m.role, content: m.text))
        .toList();
  }

  Future<void> _send([String? preset]) async {
    final text = (preset ?? _input.text).trim();
    if (text.isEmpty || !_canType) return;

    if (_loadingHistory) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Loading chat history — try again in a moment.')),
      );
      return;
    }

    if (!_availability.apiReachable) {
      await _checkAi();
      if (!mounted) return;
      if (!_availability.apiReachable) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Cannot reach the recipe API. In admin Settings set Mobile Recipe API URL to '
              'https://boon-hua-fishery.onrender.com and save.',
            ),
          ),
        );
        return;
      }
    }

    setState(() {
      _sending = true;
      _messages.add(_UiMessage(role: 'user', text: text));
      _input.clear();
    });
    _scrollToEnd();

    try {
      await _historyStore.saveMessage(role: 'user', content: text);
    } catch (_) {}

    try {
      final history = _historyForApi();
      if (history.isNotEmpty) history.removeLast();

      final result = await _service.chat(
        message: text,
        freezerItems: widget.freezerItems,
        history: history,
      );

      if (!mounted) return;
      final replyText = result.reply;
      final assistant = _UiMessage(
        role: 'assistant',
        text: replyText,
        recipes: result.recipeMaps,
      );
      setState(() => _messages.add(assistant));

      try {
        await _historyStore.saveMessage(
          role: 'assistant',
          content: result.reply,
          recipes: result.recipeMaps,
        );
      } catch (_) {}
    } on RecipeAiRateLimitException catch (e) {
      if (!mounted) return;
      _startCooldown(e.retryAfterSeconds);
      final errText =
          '${e.message}\n\nTry again in ${e.retryAfterSeconds} seconds.';
      setState(() {
        _messages.add(
          _UiMessage(role: 'assistant', text: errText, isError: true),
        );
      });
      try {
        await _historyStore.saveMessage(
          role: 'assistant',
          content: errText,
          isError: true,
        );
      } catch (_) {}
    } catch (e) {
      if (!mounted) return;
      final raw = e.toString().replaceFirst('Exception: ', '');
      final errText = raw.contains('catching up') ||
              raw.contains('rate-limited') ||
              raw.toLowerCase().contains('too many requests')
          ? raw
          : 'Sorry, the assistant could not respond. $raw';
      if (raw.toLowerCase().contains('too many requests') ||
          raw.contains('429')) {
        _startCooldown(60);
      }
      setState(() {
        _messages.add(
          _UiMessage(role: 'assistant', text: errText, isError: true),
        );
      });
      try {
        await _historyStore.saveMessage(
          role: 'assistant',
          content: errText,
          isError: true,
        );
      } catch (_) {}
    } finally {
      if (mounted) setState(() => _sending = false);
      _scrollToEnd();
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent + 120,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.page,
      appBar: AppBar(
        backgroundColor: AppColors.navy,
        foregroundColor: Colors.white,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'AI Recipe Chef',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
            ),
            Text(
              'Chat saved to your account',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: Color(0xFFDDE6FF),
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh API status',
            onPressed: _sending
                ? null
                : () async {
                    setState(() => _availability = RecipeAiAvailability.unknown);
                    await _checkAi();
                  },
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Clear history',
            onPressed: _loadingHistory || _sending ? null : _clearHistory,
            icon: const Icon(Icons.delete_outline),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_availability.apiDown)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              color: const Color(0xFFFFEBEE),
              child: const Text(
                'API server is not running on Render (no-server). Open the Render dashboard, confirm boon-hua-fishery is Live, '
                'then check Root Directory is boon_hua_backend and redeploy.',
                style: TextStyle(
                  color: Color(0xFFB71C1C),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            )
          else if (!_availability.apiReachable)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              color: const Color(0xFFFFEBEE),
              child: const Text(
                'Cannot reach the recipe API. Check admin Settings → Mobile Recipe API URL and that Render shows Live.',
                style: TextStyle(
                  color: Color(0xFFB71C1C),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            )
          else if (!_availability.aiEnabled)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              color: const Color(0xFFE8F4FF),
              child: const Text(
                'Quick cooking tips mode — you can still ask questions. Full AI replies when Gemini is enabled on the server.',
                style: TextStyle(
                  color: AppColors.ink,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          if (widget.freezerItems.isEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              color: const Color(0xFFE8F4FF),
              child: const Text(
                'Add items to your virtual freezer so the AI can tailor suggestions to your stock.',
                style: TextStyle(
                  color: AppColors.ink,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          Expanded(
            child: _loadingHistory
                ? const Center(child: CircularProgressIndicator(color: AppColors.teal))
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                    itemCount: _messages.length + (_sending ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (index == _messages.length) {
                        return const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: Row(
                            children: [
                              SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppColors.teal,
                                ),
                              ),
                              SizedBox(width: 10),
                              Text(
                                'Thinking…',
                                style: TextStyle(
                                  color: AppColors.muted,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        );
                      }
                      return _MessageBubble(message: _messages[index]);
                    },
                  ),
          ),
          if (!_loadingHistory && _messages.where((m) => !m.localOnly).isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _starters.map((q) {
                  return ActionChip(
                    label: Text(q, style: const TextStyle(fontSize: 11)),
                    onPressed: _canSend ? () => _send(q) : null,
                  );
                }).toList(),
              ),
            ),
          if (_cooldownSeconds > 0)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.fromLTRB(12, 0, 12, 4),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF8E1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFFFE082)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.timer_outlined, size: 18, color: Color(0xFFF57C00)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Please wait $_cooldownSeconds s before sending again',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                        color: Color(0xFFE65100),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _canSend ? _send() : null,
                      enabled: _canType,
                      decoration: InputDecoration(
                        hintText: _cooldownSeconds > 0
                            ? 'Wait $_cooldownSeconds seconds…'
                            : 'e.g. What can I cook with my prawns?',
                        filled: true,
                        fillColor: Colors.white,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: const BorderSide(color: AppColors.line),
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 12,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    style: IconButton.styleFrom(
                      backgroundColor: _canSend ? AppColors.teal : AppColors.muted,
                    ),
                    onPressed: _canSend ? () => _send() : null,
                    icon: const Icon(Icons.send_rounded, color: Colors.white),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _UiMessage {
  const _UiMessage({
    required this.role,
    required this.text,
    this.recipes = const [],
    this.isError = false,
    this.localOnly = false,
  });

  final String role;
  final String text;
  final List<Map<String, dynamic>> recipes;
  final bool isError;
  final bool localOnly;
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final _UiMessage message;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == 'user';
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment:
            isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          Container(
            constraints: BoxConstraints(
              maxWidth: MediaQuery.sizeOf(context).width * 0.85,
            ),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: isUser
                  ? AppColors.navy
                  : (message.isError
                      ? const Color(0xFFFFEBEE)
                      : Colors.white),
              borderRadius: BorderRadius.circular(14),
              border: isUser ? null : Border.all(color: AppColors.line),
            ),
            child: Text(
              message.text,
              style: TextStyle(
                color: isUser
                    ? Colors.white
                    : (message.isError ? AppColors.danger : AppColors.ink),
                height: 1.4,
                fontWeight: FontWeight.w600,
                fontSize: 14,
              ),
            ),
          ),
          if (message.recipes.isNotEmpty) ...[
            const SizedBox(height: 8),
            ...message.recipes.map((r) => _InlineAiRecipeCard(data: r)),
          ],
        ],
      ),
    );
  }
}

class _InlineAiRecipeCard extends StatelessWidget {
  const _InlineAiRecipeCard({required this.data});

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final title = data['title'] as String? ?? 'Recipe';
    final minutes = (data['minutes'] as num?)?.toInt() ?? 25;
    final ingredients = (data['ingredients'] as List<dynamic>? ?? [])
        .map((e) => '$e')
        .where((e) => e.trim().isNotEmpty)
        .toList();

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.auto_awesome, size: 16, color: AppColors.teal),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    color: AppColors.ink,
                  ),
                ),
              ),
              Text(
                '$minutes min',
                style: const TextStyle(color: AppColors.muted, fontSize: 12),
              ),
            ],
          ),
          if (ingredients.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              ingredients.take(6).join(' · '),
              style: const TextStyle(
                color: AppColors.muted,
                fontSize: 12,
                height: 1.35,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
