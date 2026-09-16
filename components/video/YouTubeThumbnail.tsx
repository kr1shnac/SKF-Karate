'use client'

import Image, { type ImageProps } from 'next/image'
import { useState } from 'react'

import { getYouTubeThumbnailUrl } from '@/lib/youtube'

type YouTubeThumbnailProps = Omit<ImageProps, 'src' | 'alt'> & {
  youtubeId: string
  alt: string
}

export default function YouTubeThumbnail({ youtubeId, alt, ...imageProps }: YouTubeThumbnailProps) {
  const [fallbackThumbnailId, setFallbackThumbnailId] = useState('')
  const quality = fallbackThumbnailId === youtubeId ? 'hqdefault' : 'maxresdefault'

  return (
    <Image
      {...imageProps}
      src={getYouTubeThumbnailUrl(youtubeId, quality)}
      alt={alt}
      unoptimized={true}
      onError={() => setFallbackThumbnailId(youtubeId)}
    />
  )
}
