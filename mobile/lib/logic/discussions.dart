import '../models/discussion.dart';
import 'threading.dart';

/// Pure helpers for per-lesson Q&A threads — port of `src/lib/discussions.ts`.
/// Delegates sort/group/permission logic to the shared threading module.

/// Group a flat list of discussion docs into single-level threads:
/// top-level questions newest-first, replies oldest-first, orphans dropped.
List<Thread<Discussion>> buildThreads(List<Discussion> docs) =>
    buildThreadTree<Discussion>(docs);

/// Whether the viewer may delete [post]: the author themselves, or an admin.
/// Mirrors the Firestore rule — clients may only create and delete, never edit.
bool canDelete({
  required String viewerUid,
  String? viewerRole,
  required Discussion post,
}) =>
    isAuthorOrAdmin(
      viewerUid: viewerUid,
      viewerRole: viewerRole,
      authorId: post.userId,
    );
