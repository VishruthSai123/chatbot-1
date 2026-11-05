"use client";

import {
  AnimatePresence,
  type PanInfo,
  LayoutGroup,
  motion,
} from "framer-motion";
import { Grid3X3, Layers, LayoutList } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A card collection that can be a swipeable stack, a grid or a list.
 *
 * The three modes are the same cards: `layoutId` lets a card move between them
 * instead of being re-created, which is what makes the switch feel like one
 * object changing shape rather than three lists swapping.
 *
 * Adapted for this app in two ways: the grid is three columns on a wide screen
 * so nine cards do not become a column five rows deep, and a drag no longer
 * fires the card's click when the pointer is released.
 */

export type LayoutMode = "grid" | "list" | "stack";

export interface CardData {
  color?: string;
  description: string;
  icon?: ReactNode;
  id: string;
  title: string;
}

export interface MorphingCardStackProps {
  cards?: CardData[];
  className?: string;
  defaultLayout?: LayoutMode;
  onCardClick?: (card: CardData) => void;
}

const layoutIcons = {
  grid: Grid3X3,
  list: LayoutList,
  stack: Layers,
};

const SWIPE_THRESHOLD = 50;
const VISIBLE_STACK_DEPTH = 5;
const SWIPE_VELOCITY = 500;

/** A card in the stack, with its position from the top. */
type PositionedCard = CardData & { stackPosition: number };

const CONTAINER_STYLES: Record<LayoutMode, string> = {
  grid: "grid w-full max-w-lg grid-cols-2 gap-3 sm:grid-cols-3",
  list: "flex w-full flex-col gap-3",
  stack: "relative h-64 w-64",
};

export function MorphingCardStack({
  cards = [],
  className,
  defaultLayout = "stack",
  onCardClick,
}: MorphingCardStackProps) {
  const [layout, setLayout] = useState<LayoutMode>(defaultLayout);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const draggedRef = useRef(false);

  if (cards.length === 0) {
    return null;
  }

  const handleDragEnd = (
    _event: MouseEvent | PointerEvent | TouchEvent,
    info: PanInfo
  ) => {
    const { offset, velocity } = info;

    if (offset.x < -SWIPE_THRESHOLD || velocity.x < -SWIPE_VELOCITY) {
      setActiveIndex((previous) => (previous + 1) % cards.length);
    } else if (offset.x > SWIPE_THRESHOLD || velocity.x > SWIPE_VELOCITY) {
      setActiveIndex(
        (previous) => (previous - 1 + cards.length) % cards.length
      );
    }

    // The click fires after pointer-up, so the guard is cleared on the next
    // tick rather than immediately — otherwise releasing a drag opens a card.
    setTimeout(() => {
      draggedRef.current = false;
    }, 0);
  };

  /**
   * The stack, top card first.
   *
   * Only the top few are drawn: a deck of nine fanned out by eight pixels each
   * spreads wider than the card itself and reads as a mess. The pager still
   * shows how many there are.
   */
  const getStackOrder = (): PositionedCard[] => {
    const ordered: PositionedCard[] = [];

    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[(activeIndex + index) % cards.length];

      ordered.push({ ...card, stackPosition: index });
    }

    return ordered;
  };

  const getLayoutStyles = (stackPosition: number) => {
    if (layout === "stack") {
      return {
        left: stackPosition * 8,
        rotate: (stackPosition - 1) * 1,
        top: stackPosition * 8,
        zIndex: VISIBLE_STACK_DEPTH - stackPosition,
      };
    }

    return { left: 0, rotate: 0, top: 0, zIndex: 1 };
  };

  const displayCards: PositionedCard[] =
    layout === "stack"
      ? // Reversed so the top card is rendered last and paints above the rest.
        getStackOrder().slice(0, VISIBLE_STACK_DEPTH).reverse()
      : cards.map((card, index) => ({ ...card, stackPosition: index }));

  return (
    <div className={cn("space-y-4", className)}>
      {/* Layout toggle */}
      <div className="mx-auto flex w-fit items-center justify-center gap-1 rounded-lg bg-secondary/50 p-1">
        {(Object.keys(layoutIcons) as LayoutMode[]).map((mode) => {
          const Icon = layoutIcons[mode];

          return (
            <button
              aria-label={`Switch to ${mode} layout`}
              className={cn(
                "cursor-pointer rounded-md p-2 transition-all",
                layout === mode
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              key={mode}
              onClick={() => setLayout(mode)}
              type="button"
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>

      {/* Cards */}
      <LayoutGroup>
        <motion.div
          className={cn(CONTAINER_STYLES[layout], "mx-auto")}
          layout
        >
          <AnimatePresence mode="popLayout">
            {displayCards.map((card) => {
              const styles = getLayoutStyles(card.stackPosition);
              const isExpanded = expandedCard === card.id;
              const isTopCard =
                layout === "stack" && card.stackPosition === 0;

              return (
                <motion.div
                  animate={{
                    opacity: 1,
                    scale: isExpanded ? 1.05 : 1,
                    x: 0,
                    ...styles,
                  }}
                  className={cn(
                    "cursor-pointer rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50",
                    layout === "stack" && "absolute h-48 w-56",
                    layout === "stack" &&
                      isTopCard &&
                      "cursor-grab active:cursor-grabbing",
                    layout === "grid" && "aspect-square w-full",
                    layout === "list" && "w-full",
                    isExpanded && "ring-2 ring-primary"
                  )}
                  drag={isTopCard ? "x" : false}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.7}
                  exit={{ opacity: 0, scale: 0.8, x: -200 }}
                  initial={{ opacity: 0, scale: 0.8 }}
                  key={card.id}
                  layoutId={card.id}
                  onClick={() => {
                    if (draggedRef.current) {
                      return;
                    }

                    setExpandedCard(isExpanded ? null : card.id);
                    onCardClick?.(card);
                  }}
                  onDragEnd={handleDragEnd}
                  onDragStart={() => {
                    draggedRef.current = true;
                  }}
                  style={{ backgroundColor: card.color || undefined }}
                  transition={{
                    damping: 25,
                    stiffness: 300,
                    type: "spring",
                  }}
                  whileDrag={{ cursor: "grabbing", scale: 1.02 }}
                >
                  <div className="flex items-start gap-3">
                    {card.icon ? (
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                        {card.icon}
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold text-card-foreground">
                        {card.title}
                      </h3>
                      <p
                        className={cn(
                          "mt-1 text-sm text-muted-foreground",
                          layout === "stack" && "line-clamp-3",
                          layout === "grid" && "line-clamp-2",
                          layout === "list" && "line-clamp-1"
                        )}
                      >
                        {card.description}
                      </p>
                    </div>
                  </div>

                  {isTopCard ? (
                    <div className="absolute right-0 bottom-2 left-0 text-center">
                      <span className="text-xs text-muted-foreground/50">
                        Swipe to navigate
                      </span>
                    </div>
                  ) : null}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </LayoutGroup>

      {/* Stack pager */}
      {layout === "stack" && cards.length > 1 ? (
        <div className="flex justify-center gap-1.5">
          {cards.map((card, index) => (
            <button
              aria-label={`Go to ${card.title}`}
              className={cn(
                "h-1.5 cursor-pointer rounded-full transition-all",
                index === activeIndex
                  ? "w-4 bg-primary"
                  : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              )}
              key={card.id}
              onClick={() => setActiveIndex(index)}
              type="button"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The name the component was published under. */
export const Component = MorphingCardStack;
