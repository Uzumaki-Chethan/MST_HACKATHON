// SPEC §8.4 inspection templates. vantageId is "<room>-<view>".
export type Vantage = { room: string; vantageId: string; label: string };

const v = (room: string, vantageId: string, label: string): Vantage => ({ room, vantageId, label });

export const INSPECTION_TEMPLATES: Record<"full" | "compact", Vantage[]> = {
  full: [
    v("living", "living-wide", "Living room: wide"),
    v("living", "living-walls", "Living room: walls"),
    v("living", "living-floor", "Living room: floor"),
    v("living", "living-door", "Living room: door"),
    v("kitchen", "kitchen-wide", "Kitchen: wide"),
    v("kitchen", "kitchen-counter", "Kitchen: counter"),
    v("kitchen", "kitchen-sink", "Kitchen: sink"),
    v("kitchen", "kitchen-cabinets", "Kitchen: cabinets"),
    v("bedroom1", "bed1-wide", "Bedroom 1: wide"),
    v("bedroom1", "bed1-wardrobe", "Bedroom 1: wardrobe"),
    v("bedroom1", "bed1-window", "Bedroom 1: window"),
    v("bathroom1", "bath1-wide", "Bathroom 1: wide"),
    v("bathroom1", "bath1-fittings", "Bathroom 1: fittings"),
    v("bathroom1", "bath1-floor", "Bathroom 1: floor"),
    v("balcony", "balcony-wide", "Balcony: wide"),
  ],
  compact: [
    v("living", "living-wide", "Living room: wide"),
    v("kitchen", "kitchen-counter", "Kitchen: counter"),
    v("bedroom1", "bed1-wall", "Bedroom 1: wall"),
    v("bathroom1", "bath1-fittings", "Bathroom 1: fittings"),
  ],
};
