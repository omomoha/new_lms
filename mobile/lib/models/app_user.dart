import 'package:cloud_firestore/cloud_firestore.dart';

/// Mirrors `AppUser` in the web portal's src/types.ts.
/// Firestore path: users/{uid}
class AppUser {
  final String uid;
  final String email;
  final String name;
  final String role; // "admin" | "learner"
  final List<String> cohortIds;
  final String status; // "active" | "inactive" | "pending"

  const AppUser({
    required this.uid,
    required this.email,
    required this.name,
    required this.role,
    required this.cohortIds,
    required this.status,
  });

  bool get isLearner => role == 'learner';
  bool get isAdmin => role == 'admin';
  bool get isInactive => status == 'inactive';

  AppUser copyWith({
    String? uid,
    String? email,
    String? name,
    String? role,
    List<String>? cohortIds,
    String? status,
  }) {
    return AppUser(
      uid: uid ?? this.uid,
      email: email ?? this.email,
      name: name ?? this.name,
      role: role ?? this.role,
      cohortIds: cohortIds ?? this.cohortIds,
      status: status ?? this.status,
    );
  }

  factory AppUser.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    return AppUser(
      uid: doc.id,
      email: (data['email'] ?? '') as String,
      name: (data['name'] ?? '') as String,
      role: (data['role'] ?? 'learner') as String,
      cohortIds: List<String>.from((data['cohortIds'] ?? const <String>[]) as List),
      status: (data['status'] ?? 'active') as String,
    );
  }
}
