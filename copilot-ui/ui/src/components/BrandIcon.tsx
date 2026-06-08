import React from 'react';

interface BrandIconProps {
  /** Path to the SVG file, e.g. '/icons/claude.svg' */
  src: string;
  size?: number;
  className?: string;
  alt?: string;
}

export default function BrandIcon({ src, size = 18, className, alt = '' }: BrandIconProps) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0, filter: 'brightness(0.85)' }}
      aria-hidden="true"
    />
  );
}
