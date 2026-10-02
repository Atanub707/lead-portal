import { createElement } from "react";
import {
  BarChart3,
  Briefcase,
  Building2,
  Car,
  Globe,
  Heart,
  House,
  Landmark,
  Layers,
  Package,
  Rocket,
  ShieldCheck,
  ShoppingCart,
  Store,
  Utensils,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

const PIPELINE_ICON_MAP: Record<string, LucideIcon> = {
  layers: Layers,
  store: Store,
  "shield-check": ShieldCheck,
  rocket: Rocket,
  briefcase: Briefcase,
  "building-2": Building2,
  users: Users,
  "shopping-cart": ShoppingCart,
  "bar-chart-3": BarChart3,
  globe: Globe,
  heart: Heart,
  landmark: Landmark,
  package: Package,
  utensils: Utensils,
  car: Car,
  house: House,
  zap: Zap,
};

export function pipelineIcon(name: string): LucideIcon {
  return PIPELINE_ICON_MAP[name] ?? Layers;
}

export function PipelineIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = pipelineIcon(name);
  return createElement(Icon, {
    className,
    strokeWidth: 1.75,
    "aria-hidden": true,
  });
}
