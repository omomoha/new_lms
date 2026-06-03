interface BadgeProps {
  label: string;
  color?: string; // hex, e.g. "#8FB85C"
  variant?: "default" | "success" | "warning" | "error";
}

const VARIANT_CLASSES: Record<string, string> = {
  default: "bg-gray-100 text-gray-700",
  success: "bg-green-100 text-green-700",
  warning: "bg-yellow-100 text-yellow-700",
  error: "bg-red-100 text-red-700",
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
    <span className={`badge ${VARIANT_CLASSES[variant]}`}>{label}</span>
  );
}
