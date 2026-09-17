import Link from 'next/link'
import { ArrowUpRight, BookOpen, Clock, Layers3, Search } from 'lucide-react'

import { getPublishedBlogPostsLive } from '@/lib/server/repositories/blogs-live'
import { formatLocaleDate } from '@/lib/utils/format-date'
import JsonLdScript from '@/components/JsonLdScript'
import { buildBreadcrumbJsonLd, buildSeoMetadata } from '@/data/constants/seo'
import { absoluteSiteUrl } from '@/data/constants/siteConfig'
import './blog.css'

export const metadata = buildSeoMetadata(
  '/blog',
  'Read SKF Karate guides on karate classes, kata, kumite, belts, self-defense, kids karate, adult training, dojo etiquette, and martial arts basics here.'
)

function formatDate(value: string | null) {
  if (!value) return 'SKF Guide'

  return formatLocaleDate(value, 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default async function BlogPage() {
  const posts = await getPublishedBlogPostsLive()
  const breadcrumbJsonLd = buildBreadcrumbJsonLd('Blog', '/blog')
  
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'SKF Karate Journal',
    description: 'Practical karate guides, written for real students. Clear answers for beginners, parents, adult students, belt progression, dojo etiquette, kata, kumite, cost, and training mindset.',
    url: absoluteSiteUrl('/blog'),
    publisher: {
      '@type': 'Organization',
      name: 'SKF Karate'
    },
    blogPost: posts.map(post => ({
      '@type': 'BlogPosting',
      headline: post.title,
      url: absoluteSiteUrl(`/blog/${post.slug}`),
      datePublished: post.publishedAt || post.createdAt
    }))
  }

  const featuredPosts = posts.filter((post) => post.isFeatured).slice(0, 3)
  const heroPost = featuredPosts[0] || posts[0]
  const secondaryFeaturedPosts = featuredPosts.filter((post) => post.slug !== heroPost?.slug)
  const categories = Array.from(new Set(posts.map((post) => post.category).filter(Boolean)))
  const totalMinutes = posts.reduce((total, post) => total + Number(post.readMinutes || 0), 0)

  return (
    <main className="blog-page">
      <JsonLdScript data={breadcrumbJsonLd} />
      <JsonLdScript data={jsonLd} />

      {/* Ambient Orbs */}
      <div className="blog-amb-orb blog-amb-orb--1" aria-hidden="true" />
      <div className="blog-amb-orb blog-amb-orb--2" aria-hidden="true" />

      <section className="blog-hero" aria-labelledby="blog-title">
        <div className="blog-hero__content">
          <div className="blog-hero__copy blog-reveal blog-reveal--1">
            <div className="blog-eyebrow">
              <BookOpen size={15} />
              SKF Karate Journal
            </div>
            <h1 id="blog-title" className="blog-hero__title">
              Practical karate guides, written for real students.
            </h1>
            <p className="blog-hero__lead">
              Clear answers for beginners, parents, adult students, belt progression,
              dojo etiquette, kata, kumite, cost, and training mindset.
            </p>
            <div className="blog-hero__stats" aria-label="Blog summary">
              <span>{posts.length} guides</span>
              <span>{categories.length} topics</span>
              <span>{totalMinutes} min total</span>
            </div>
          </div>

          {heroPost ? (
            <div className="blog-hero__spotlight blog-reveal blog-reveal--2">
              <Link href={`/blog/${heroPost.slug}`} className="blog-hero__start">
                <span className="blog-hero__feature-kicker">Start here</span>
                <strong>{heroPost.title}</strong>
                <span>{heroPost.excerpt}</span>
                <small>
                  Read guide <ArrowUpRight size={14} />
                </small>
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      <section className="blog-shell" aria-label="Blog guide list">
        <div className="blog-section-head blog-reveal blog-reveal--3">
          <div>
            <span className="blog-section-head__kicker">
              <Layers3 size={15} />
              Browse by topic
            </span>
            <h2>Featured guides</h2>
          </div>
          <div className="blog-topic-row" aria-label="Blog topics">
            {categories.map((category) => (
              <span key={category}>{category}</span>
            ))}
          </div>
        </div>

        {secondaryFeaturedPosts.length > 0 ? (
          <section className="blog-featured blog-reveal blog-reveal--4" aria-label="Featured blog guides">
            {secondaryFeaturedPosts.map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="blog-featured__item">
                <span>{post.category}</span>
                <strong>{post.title}</strong>
                <small>
                  Read guide <ArrowUpRight size={14} />
                </small>
              </Link>
            ))}
          </section>
        ) : null}

        <div className="blog-list-head blog-reveal blog-reveal--5">
          <span>
            <Search size={15} />
            Latest guides
          </span>
          <span>Updated {formatDate(posts[0]?.publishedAt || null)}</span>
        </div>

        <div className="blog-list blog-list--text blog-reveal blog-reveal--6">
          {posts.map((post, index) => (
            <article
              key={post.slug}
              id={`post-${post.slug}`}
              className="blog-row blog-row--text"
            >
              <div className="blog-row__number">{String(index + 1).padStart(2, '0')}</div>

              <div className="blog-row__body">
                <div className="blog-row__meta">
                  <span>{post.category}</span>
                  <span>{formatDate(post.publishedAt)}</span>
                  <span><Clock size={13} /> {post.readMinutes} min</span>
                </div>
                <h3>
                  <Link href={`/blog/${post.slug}`}>{post.title}</Link>
                </h3>
                <p>{post.excerpt}</p>
              </div>

              <Link href={`/blog/${post.slug}`} className="blog-row__action" aria-label={`Read ${post.title}`}>
                <ArrowUpRight size={18} />
              </Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
