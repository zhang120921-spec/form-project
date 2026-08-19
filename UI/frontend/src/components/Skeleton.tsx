import styles from "./Skeleton.module.css";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  circle?: boolean;
  className?: string;
}

/** A single shimmering placeholder block. Compose several to match the shape of the content that's loading. */
export function Skeleton({ width, height, circle, className }: SkeletonProps) {
  return (
    <span
      className={`${styles.block}${circle ? ` ${styles.circle}` : ""}${className ? ` ${className}` : ""}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** A handful of skeleton lines with varied trailing widths, for paragraph/label placeholders. */
export function SkeletonLines({ count = 3, lastWidth = "60%" }: { count?: number; lastWidth?: string }) {
  return (
    <div className={styles.lines} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height="1em" width={i === count - 1 ? lastWidth : "100%"} />
      ))}
    </div>
  );
}

/** A card-shaped skeleton: avatar/eyebrow row plus body lines — matches the app's common card layout. */
export function SkeletonCard({ withAvatar = true }: { withAvatar?: boolean }) {
  return (
    <div className={styles.card} role="status" aria-label="Loading">
      {withAvatar && (
        <div className={styles.cardHead}>
          <Skeleton circle width={40} height={40} />
          <Skeleton height="1.1em" width="40%" />
        </div>
      )}
      <SkeletonLines count={2} lastWidth="45%" />
    </div>
  );
}

/** Stack of card skeletons — the common "list is loading" state. */
export function SkeletonList({ count = 3, withAvatar = true }: { count?: number; withAvatar?: boolean }) {
  return (
    <div className={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} withAvatar={withAvatar} />
      ))}
    </div>
  );
}
