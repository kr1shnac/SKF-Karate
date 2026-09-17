import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowUpRight, BookOpen, CalendarDays, Clock } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import {
  getBlogPostBySlugLive,
  getPublishedBlogPostsLive,
} from '@/lib/server/repositories/blogs-live'
import { absoluteMediaUrl, absoluteSiteUrl } from '@/data/constants/siteConfig'
import { formatLocaleDate } from '@/lib/utils/format-date'
import JsonLdScript from '@/components/JsonLdScript'
import { buildBreadcrumbJsonLd, buildSeoMetadata } from '@/data/constants/seo'
import BlogReadingClient from './BlogReadingClient'
import '../blog.css'

type PageProps = {
  params: Promise<{ slug: string }>
}



function formatDate(value: string | null) {
  if (!value) return 'SKF Guide'

  return formatLocaleDate(value, 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params
  const post = await getBlogPostBySlugLive(slug)

  if (!post) {
    return buildSeoMetadata('/blog', 'Read SKF Karate guides on karate classes, kata, kumite, belts, self-defense, kids karate, adult training, dojo etiquette, and martial arts basics here.')
  }

  return buildSeoMetadata(
    `/blog/${post.slug}`,
    `${post.title}. ${post.excerpt}`,
    { 
      image: post.coverImageUrl || '/og-image.png', 
      imageAlt: post.title,
      keywords: post.tags 
    }
  )
}

export default async function BlogDetailPage({ params }: PageProps) {
  const { slug } = await params
  const [post, posts] = await Promise.all([
    getBlogPostBySlugLive(slug),
    getPublishedBlogPostsLive(),
  ])

  if (!post) notFound()

  const related = posts
    .filter((entry) => entry.slug !== post.slug && entry.category === post.category)
    .slice(0, 3)

  const fallbackRelated = related.length > 0
    ? related
    : posts.filter((entry) => entry.slug !== post.slug).slice(0, 3)


  const orderedPosts = [...posts].sort((a, b) => {
    const orderDiff = Number(a.sortOrder || 999) - Number(b.sortOrder || 999)
    if (orderDiff !== 0) return orderDiff

    return a.title.localeCompare(b.title)
  })
  const moreGuides = Array.from(
    new Map(
      [...fallbackRelated, ...orderedPosts]
        .filter((entry) => entry.slug !== post.slug)
        .map((entry) => [entry.slug, entry])
    ).values()
  ).slice(0, 3)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    image: absoluteMediaUrl(post.coverImageUrl || '/og-image.png'),
    author: {
      '@type': 'Organization',
      name: post.authorName,
    },
    publisher: {
      '@type': 'Organization',
      name: 'SKF Karate',
      logo: {
        '@type': 'ImageObject',
        url: absoluteMediaUrl('/logo/SKF logo.png'),
      },
    },
    datePublished: post.publishedAt || post.createdAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: absoluteSiteUrl(`/blog/${post.slug}`),
    keywords: post.tags.join(', '),
    articleSection: post.category,
    wordCount: post.content.split(/\\s+/).length,
  }
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(post.title, `/blog/${post.slug}`)

  return (
    <main className="blog-page blog-page--article">
      <JsonLdScript data={breadcrumbJsonLd} />
      <JsonLdScript data={jsonLd} />

      {/* Ambient Orbs */}
      <div className="blog-amb-orb blog-amb-orb--1" aria-hidden="true" />
      <div className="blog-amb-orb blog-amb-orb--2" aria-hidden="true" />

      {/* Reading Progress + Back to Top */}
      <BlogReadingClient />

      <article className="blog-reader" aria-labelledby="article-title">
        <Link href="/blog" className="blog-back-link blog-reveal blog-reveal--1">
          <ArrowLeft size={16} />
          All blogs
        </Link>

        <header className="blog-reader__header blog-reveal blog-reveal--2">
          <div className="blog-eyebrow">
            <BookOpen size={15} />
            {post.category}
          </div>
          <h1 id="article-title">{post.title}</h1>
          <p>{post.excerpt}</p>
          <div className="blog-reader__meta" aria-label="Article details">
            <span>{post.authorName}</span>
            <span>
              <Clock size={14} />
              {post.readMinutes} min read
            </span>
            <span>
              <CalendarDays size={14} />
              {formatDate(post.publishedAt || post.createdAt)}
            </span>
          </div>
        </header>

        <div className="blog-reader__content blog-reveal blog-reveal--3 blog-prose">
          <ReactMarkdown>{post.content}</ReactMarkdown>
        </div>
      </article>

      {moreGuides.length > 0 ? (
        <section className="blog-reader-more blog-reveal blog-reveal--4" aria-labelledby="more-guides-title">
          <h2 id="more-guides-title">More guides</h2>
          <div className="blog-reader-more__list">
            {moreGuides.map((entry) => (
              <Link key={entry.slug} href={`/blog/${entry.slug}`} className="blog-reader-more__item">
                <span>
                  <small>{entry.category}</small>
                  <strong>{entry.title}</strong>
                </span>
                <span className="blog-reader-more__arrow">
                  Read <ArrowUpRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}
