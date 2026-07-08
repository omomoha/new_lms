import 'dart:async';

import 'package:flutter/material.dart';

/// Debounced search field with a clear button for the dashboard course grid.
/// Pure UI: the actual filtering lives in logic/search.dart. Mirrors the web
/// CourseSearch component.
class CourseSearch extends StatefulWidget {
  const CourseSearch({
    super.key,
    required this.onQueryChange,
    this.debounce = const Duration(milliseconds: 250),
  });

  final ValueChanged<String> onQueryChange;
  final Duration debounce;

  @override
  State<CourseSearch> createState() => _CourseSearchState();
}

class _CourseSearchState extends State<CourseSearch> {
  final _controller = TextEditingController();
  Timer? _timer;

  void _onChanged(String value) {
    _timer?.cancel();
    _timer = Timer(widget.debounce, () => widget.onQueryChange(value));
    setState(() {}); // toggle clear button
  }

  void _clear() {
    _timer?.cancel();
    _controller.clear();
    widget.onQueryChange('');
    setState(() {});
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      textInputAction: TextInputAction.search,
      onChanged: _onChanged,
      decoration: InputDecoration(
        hintText: 'Search courses…',
        prefixIcon: const Icon(Icons.search),
        suffixIcon: _controller.text.isNotEmpty
            ? IconButton(
                icon: const Icon(Icons.close),
                tooltip: 'Clear search',
                onPressed: _clear,
              )
            : null,
      ),
    );
  }
}
