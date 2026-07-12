import React from 'react';
import { assetPath } from '../lib/assetPath';

interface BrandIconProps {
  /** Path to the SVG file, e.g. '/icons/claude.svg' */
  src: string;
  size?: number;
  className?: string;
  alt?: string;
}

export default function BrandIcon({ src, size = 18, className, alt = '' }: BrandIconProps) {
  const fallback = assetPath('icons/terminal.svg');
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0 }}
      onError={(event) => {
        const image = event.currentTarget;
        if (image.src.endsWith(fallback)) return;
        image.src = fallback;
      }}
      aria-hidden={alt ? undefined : true}
    />
  );
}
