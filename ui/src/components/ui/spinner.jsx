import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function Spinner({ className, size = "default", ...props }) {
  const sizeClass = size === "sm" ? "size-4" : size === "lg" ? "size-8" : "size-5";
  return <Loader2 className={cn("animate-spin text-primary", sizeClass, className)} {...props} />;
}

export { Spinner };
