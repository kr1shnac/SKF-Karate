import type { MetadataRoute } from 'next'

import { getPublishedBlogPostsLive } from '@/lib/server/repositories/blogs-live'
import { getAllCitiesLive } from '@/lib/server/repositories/classes-live'
import { getAllEventsLive } from '@/lib/server/repositories/events-live'
import { getProducts } from '@/lib/server/repositories/products'
import {
  getPublicExecutiveCommitteeLive,
  getPublicSenseisLive,
} from '@/lib/server/repositories/senseis-live'
import { getAllTournamentsLive } from '@/lib/server/repositories/tournaments-live'
import { absoluteSiteUrl } from '@/data/constants/siteConfig'

type SitemapRoute = {
  path: string
  priority: number
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']
}

const LAST_MODIFIED = new Date()

const staticRoutes: SitemapRoute[] = [
  { path: '/', priority: 1.0, changeFrequency: 'weekly' },
  { path: '/about', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/classes', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/contact', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/book-trial', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/grading', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/events', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/results', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/rankings', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/honours', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/gallery', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/blog', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/shop', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/techniques', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/privacy-policy', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/cookie-policy', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/terms-of-service', priority: 0.5, changeFrequency: 'yearly' },
]

const techniqueBelts = ['white', 'yellow', 'orange', 'green', 'blue', 'brown', 'black']

function uniqueRoutes(routes: SitemapRoute[]) {
  return Array.from(new Map(routes.map((route) => [route.path, route])).values())
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [cities, events, tournaments, posts, products, senseis, executiveCommittee] = await Promise.all([
    getAllCitiesLive(),
    getAllEventsLive(),
    getAllTournamentsLive(),
    getPublishedBlogPostsLive(),
    getProducts(),
    getPublicSenseisLive(),
    getPublicExecutiveCommitteeLive(),
  ])

  const classRoutes = cities.flatMap((city) => {
    const branchRoutes = city.branches.map((branch) => ({
      path: `/classes/${city.slug}/${branch.slug}`,
      priority: 0.8,
      changeFrequency: 'monthly' as const,
    }))

    if (city.branches.length === 1 && city.schools.length === 0) {
      return branchRoutes
    }

    return [
      {
        path: `/classes/${city.slug}`,
        priority: 0.8,
        changeFrequency: 'monthly' as const,
      },
      ...branchRoutes,
    ]
  })

  const eventRoutes = events
    .filter((event) => event.type !== 'tournament')
    .map((event) => ({
      path: `/events/${event.slug}`,
      priority: 0.8,
      changeFrequency: 'monthly' as const,
    }))

  const resultRoutes = tournaments.map((tournament) => ({
    path: `/results/${tournament.slug}`,
    priority: 0.8,
    changeFrequency: 'monthly' as const,
  }))

  const blogRoutes = posts.map((post) => ({
    path: `/blog/${post.slug}`,
    priority: 0.8,
    changeFrequency: 'weekly' as const,
  }))

  const instructors = Array.from(
    new Map([...senseis, ...executiveCommittee].map((instructor) => [instructor.slug, instructor])).values()
  )

  const instructorRoutes = instructors.map((instructor) => ({
    path: `/instructors/${instructor.slug}`,
    priority: 0.7,
    changeFrequency: 'monthly' as const,
  }))

  const productRoutes = products
    .filter((product) => product.is_public)
    .map((product) => ({
      path: `/shop/${product.id}`,
      priority: 0.7,
      changeFrequency: 'weekly' as const,
    }))

  const techniqueRoutes = techniqueBelts.map((belt) => ({
    path: `/techniques/${belt}`,
    priority: 0.7,
    changeFrequency: 'monthly' as const,
  }))

  return uniqueRoutes([
    ...staticRoutes,
    ...classRoutes,
    ...eventRoutes,
    ...resultRoutes,
    ...blogRoutes,
    ...instructorRoutes,
    ...productRoutes,
    ...techniqueRoutes,
  ]).map((route) => ({
    url: absoluteSiteUrl(route.path),
    lastModified: LAST_MODIFIED,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))
}
