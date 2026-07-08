import 'package:chewie/chewie.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../../logic/progress.dart';
import '../../services/firestore_service.dart';
import '../../services/video_service.dart';
import '../../theme/app_theme.dart';

/// Firebase-Storage video with resume + throttled progress saves + auto
/// mark-complete on end. URL resolved via [VideoService] (getSignedVideoUrl).
/// Mirrors the web VideoPlayer, including the completedAt overwrite guard:
/// once a lesson is completed we never write completedAt back to null.
class StorageVideo extends StatefulWidget {
  const StorageVideo({
    super.key,
    required this.uid,
    required this.courseId,
    required this.lessonId,
    required this.videoPath,
    required this.videoService,
    required this.firestore,
    required this.initiallyCompleted,
    required this.resumePositionSec,
    required this.onCompleted,
  });

  final String uid;
  final String courseId;
  final String lessonId;
  final String videoPath;
  final VideoService videoService;
  final FirestoreService firestore;
  final bool initiallyCompleted;
  final int? resumePositionSec;

  /// Called on video end or manual mark-complete — the parent controller does
  /// the progress-write + enrollment recompute.
  final VoidCallback onCompleted;

  @override
  State<StorageVideo> createState() => _StorageVideoState();
}

class _StorageVideoState extends State<StorageVideo> {
  VideoPlayerController? _video;
  ChewieController? _chewie;
  String? _error;

  int _lastSavedMs = 0;
  bool _wasPlaying = false;
  bool _completed = false; // completedRef guard — never overwrite completedAt

  @override
  void initState() {
    super.initState();
    _completed = widget.initiallyCompleted;
    _init();
  }

  Future<void> _init() async {
    try {
      final url = await widget.videoService.getPlaybackUrl(widget.videoPath);
      final video = VideoPlayerController.networkUrl(Uri.parse(url));
      await video.initialize();
      final resume = widget.resumePositionSec ?? 0;
      if (resume > 0) {
        await video.seekTo(Duration(seconds: resume));
      }
      video.addListener(_tick);
      final chewie = ChewieController(
        videoPlayerController: video,
        autoPlay: false,
        looping: false,
        aspectRatio:
            video.value.aspectRatio == 0 ? 16 / 9 : video.value.aspectRatio,
        allowFullScreen: true,
        materialProgressColors: ChewieProgressColors(
          playedColor: AppColors.accent,
          handleColor: AppColors.accent,
          bufferedColor: AppColors.mist,
          backgroundColor: AppColors.line,
        ),
      );
      if (!mounted) {
        video.dispose();
        chewie.dispose();
        return;
      }
      setState(() {
        _video = video;
        _chewie = chewie;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Unable to load video. Check your connection.');
      }
    }
  }

  void _tick() {
    final v = _video;
    if (v == null || !v.value.isInitialized) return;
    final value = v.value;
    final pos = value.position;
    final dur = value.duration;

    // Ended → auto mark-complete (once).
    if (dur > Duration.zero && pos >= dur && !_completed) {
      _completed = true;
      widget.onCompleted();
      if (mounted) setState(() {});
      return;
    }

    // Pause transition → force-save.
    if (_wasPlaying && !value.isPlaying) {
      _save(pos, dur, force: true);
    }
    _wasPlaying = value.isPlaying;

    // Throttled save while playing.
    if (value.isPlaying) {
      _save(pos, dur, force: false);
    }
  }

  void _save(Duration pos, Duration dur, {required bool force}) {
    if (_completed) return; // guard: don't clobber completedAt
    final now = DateTime.now().millisecondsSinceEpoch;
    if (!force && !shouldSaveProgress(_lastSavedMs, now)) return;
    _lastSavedMs = now;
    final watchedPct = dur.inMilliseconds > 0
        ? ((pos.inMilliseconds / dur.inMilliseconds) * 100).round()
        : 0;
    // Fire-and-forget; failures are non-fatal to playback.
    widget.firestore.saveVideoProgress(
      uid: widget.uid,
      courseId: widget.courseId,
      lessonId: widget.lessonId,
      positionSec: pos.inSeconds,
      watchedPct: watchedPct,
    );
  }

  void _markComplete() {
    if (_completed) return;
    _lastSavedMs = DateTime.now().millisecondsSinceEpoch; // race guard
    _completed = true;
    widget.onCompleted();
    setState(() {});
  }

  @override
  void dispose() {
    _video?.removeListener(_tick);
    _chewie?.dispose();
    _video?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return AspectRatio(
        aspectRatio: 16 / 9,
        child: Container(
          decoration: BoxDecoration(
            color: Colors.black,
            borderRadius: BorderRadius.circular(16),
          ),
          alignment: Alignment.center,
          child: Text(_error!, style: const TextStyle(color: Colors.white70)),
        ),
      );
    }
    final chewie = _chewie;
    if (chewie == null) {
      return const AspectRatio(
        aspectRatio: 16 / 9,
        child: Center(child: CircularProgressIndicator()),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: AspectRatio(
            aspectRatio: chewie.aspectRatio ?? 16 / 9,
            child: Chewie(controller: chewie),
          ),
        ),
        const SizedBox(height: 12),
        if (_completed)
          const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.check_circle, color: AppColors.accent, size: 20),
              SizedBox(width: 6),
              Text('Completed',
                  style: TextStyle(
                      color: AppColors.accent, fontWeight: FontWeight.w600)),
            ],
          )
        else
          FilledButton.icon(
            onPressed: _markComplete,
            icon: const Icon(Icons.check),
            label: const Text('Mark as Complete'),
          ),
      ],
    );
  }
}
