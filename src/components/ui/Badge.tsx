import React from "react";

interface BadgeProps {
  label: string;
  color?: string; // hex, e.g. "#8FB85C"
  variant?: "default" | "success" | "warning" | "error";
}

const VARIANT_CLASSES: Record<string, string> = {
  default: "bg-gray-100 text-gray-600",
  success: "text-white",
  warning: "text-white",
  error: "bg-red-100 text-red-700",
};

const VARIANT_STYLES: Record<string, React.CSSProperties> = {
  default: {},
  success: { backgroundColor: "#2C7A6B" },
  warning: { backgroundColor: "#8FB85C", color: "#13403A" },
  error: {},
};

export function Badge({ label, color, variant = "default" }: BadgeProps) {
  if (color) {
    return (
      <span
        className="badge text-white"
        style={{ backgroundColor: color }}
      >
        {label}
      </span>
    );
  }
  return (
    <span className={`badge ${VARIANT_CLASSES[variant]}`} style={VARIANT_STYLES[variant]}>{label}</span>
  );
}
