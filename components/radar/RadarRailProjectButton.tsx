import type { ComponentProps } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";

export function RadarRailProjectButton({ projectId, pinned, className, style, ...props }:
  ComponentProps<"button"> & { projectId: string; pinned: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: projectId, disabled: !pinned });
  return <button
    ref={setNodeRef}
    {...(pinned ? attributes : {})}
    {...(pinned ? listeners : {})}
    {...props}
    className={cn(className, pinned && "radar-rail-project-sortable", isDragging && "radar-rail-project-dragging")}
    style={{ ...style, transform: CSS.Transform.toString(transform), transition }}
  />;
}
