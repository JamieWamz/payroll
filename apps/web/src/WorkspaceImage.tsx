import { useState } from 'react';

// Fixed public artwork only: never put company or employee data into CDN URLs.
const photos = {
  office: 'photo-1497366754035-f200968a6e72',
  studio: 'photo-1497366811353-6870744d04b2',
} as const;

export function WorkspaceImage({
  scene,
  className = '',
  priority = false,
}: {
  scene: keyof typeof photos;
  className?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const source = (width: number) =>
    `https://images.unsplash.com/${photos[scene]}?auto=format&fit=crop&w=${width}&q=75`;
  return (
    <div
      className={`workspace-image ${className}`}
      data-image-state={failed ? 'fallback' : 'image'}
      aria-hidden="true"
    >
      {!failed && (
        <img
          src={source(960)}
          srcSet={`${source(480)} 480w, ${source(960)} 960w, ${source(1440)} 1440w`}
          sizes={
            scene === 'office'
              ? '(max-width: 750px) 100vw, 50vw'
              : '(max-width: 750px) 100vw, 280px'
          }
          alt=""
          width={1440}
          height={960}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'low'}
          decoding="async"
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
