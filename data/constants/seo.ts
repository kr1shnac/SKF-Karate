import type { Metadata } from 'next'

import { CONTACT, SOCIAL_LINKS } from './contact'
import { absoluteMediaUrl, absoluteSiteUrl, DEFAULT_OG_IMAGE, generateCanonicalUrl, SITE_CONFIG } from './siteConfig'

/* ══════════════════════════════════════════════════════════════
   SEO CONSTANTS — V2 Enhanced (Digital USP + All-Area Targeting)
   ══════════════════════════════════════════════════════════════ */

export const SEO_TITLE =
  "SKF Karate | India's #1 Digital Karate Association | Student Tracking & Rankings | Karnataka's Premier Martial Arts Club"

export const SEO_TITLE_SHORT = 'SKF Karate'

export const SEO_KEYWORDS =
  'SKF, SKF Karate, Sports Karate Do Fitness and Self-Defense Association, karate association India, best karate India, Karnataka karate, Bangalore karate, Kunigal karate, Herohalli karate, Anjanagar karate, Ullal Nagar karate, karate training Bangalore, karate tournament India, self-defense Karnataka, martial arts Bangalore, digital karate association India, student ranking karate, karate history tracking, karate profile India, karate for kids Bangalore, karate championship Karnataka, number one karate India, best karate Karnataka, karate near me Bangalore, karate classes Magadi Road, karate Sunkadakatte, karate Vijayanagar, karate Rajajinagar, karate Malleshwaram, karate JP Nagar, karate Banashankari, karate Electronic City, karate Whitefield, karate Indiranagar, kumite, kata, black belt India, karate federation, shotokan karate, karate dojo, kihon, kobudo, self-defense classes, karate for adults, karate for women, online karate student tracking India, karate student ranking system India, karate belt tracking, karate achievement records, modern karate association India, karate blog India, martial arts blog, karate tips, learn karate online, karate guide, best karate blog'

export const SEO_ROBOTS =
  'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1'

export const SEO_IMAGE_ALT =
  "SKF Karate – India's #1 Digital Karate Association | Student Rankings | Karnataka"

/* ══════════════════════════════════════════════════════════════
   HELPER UTILITIES
   ══════════════════════════════════════════════════════════════ */

type SeoMetadataOptions = {
  image?: string
  imageAlt?: string
  /** Override the default SEO_TITLE for this page */
  title?: string
  /** Add additional keywords specific to this page */
  keywords?: string[]
}

function cleanDescription(description: string) {
  return description.replace(/\s+/g, ' ').trim()
}

export function normalizeMetaDescription(description: string, fallback = '') {
  const clean = cleanDescription(description || fallback)

  if (clean.length <= 160) return clean

  const shortened = clean.slice(0, 157).replace(/\s+\S*$/, '')
  return `${shortened}...`
}

/* ══════════════════════════════════════════════════════════════
   buildSeoMetadata — Central metadata builder for all pages
   ══════════════════════════════════════════════════════════════ */

export function buildSeoMetadata(
  path: string,
  description: string,
  options: SeoMetadataOptions = {}
): Metadata {
  const canonicalUrl = generateCanonicalUrl(path)
  const imageUrl = options.image ? absoluteMediaUrl(options.image) : absoluteMediaUrl(DEFAULT_OG_IMAGE)
  const imageAlt = options.imageAlt || SEO_IMAGE_ALT
  const metaDescription = normalizeMetaDescription(description)
  const title = options.title || SEO_TITLE
  
  const mergedKeywords = options.keywords 
    ? `${options.keywords.join(', ')}, ${SEO_KEYWORDS}` 
    : SEO_KEYWORDS

  return {
    title,
    description: metaDescription,
    keywords: mergedKeywords,
    authors: [{ name: 'Sports Karate Do Fitness and Self-Defense Association (SKF)' }],
    publisher: 'SKF – Sports Karate Do Fitness and Self-Defense Association',
    robots: SEO_ROBOTS,
    alternates: {
      canonical: canonicalUrl,
      languages: {
        'en-IN': canonicalUrl,
        'en': canonicalUrl,
        'x-default': canonicalUrl,
      },
    },
    other: {
      'geo.region': 'IN-KA',
      'geo.placename': 'Kunigal, Bangalore, Karnataka, India',
      'geo.position': '12.9716;77.5186',
      ICBM: '12.9716, 77.5186',
      'revisit-after': '7 days',
      category: 'Sports, Martial Arts, Karate, Self-Defense, Fitness',
      classification: 'Sports Organization, Martial Arts Association, Karate Federation',
      coverage: 'India, Karnataka, Bangalore, Kunigal',
      distribution: 'Global',
      'copyright': '© SKF Sports Karate Do Fitness and Self-Defense Association, India',
    },
    openGraph: {
      type: 'website',
      siteName: 'SKF – Sports Karate Do Fitness and Self-Defense Association',
      title: "SKF | India's #1 Digital Karate Association | Student Rankings & History Tracking | Karnataka's Premier Karate Club",
      description:
        "SKF (Sports Karate Do Fitness and Self-Defense Association) — India's only karate association with digital student profiles, live rankings, and full achievement tracking. Expert karate training in Bangalore (Herohalli, Anjanagar, Ullal Nagar), Kunigal, and all Karnataka. Join India's #1 karate club.",
      url: canonicalUrl,
      locale: 'en_IN',
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: imageAlt,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: "SKF | India's #1 Karate Association | Digital Student Tracking | Karnataka's Premier Club",
      description:
        "SKF — India's first digital karate association. Student profiles, live rankings, full achievement tracking + expert karate training across Bangalore & Karnataka.",
      images: [
        {
          url: imageUrl,
          alt: imageAlt,
        },
      ],
    },
  }
}

export function buildNoIndexMetadata(path: string, description: string): Metadata {
  return {
    ...buildSeoMetadata(path, description),
    robots: 'noindex, nofollow',
  }
}

/* ══════════════════════════════════════════════════════════════
   JSON-LD — Homepage (V2 Enhanced with Digital USP)
   ══════════════════════════════════════════════════════════════ */

export function buildHomeJsonLd() {
  const homepageUrl = absoluteSiteUrl('/')
  const logoUrl = absoluteMediaUrl(SITE_CONFIG.LOGO_PATH)
  const imageUrl = absoluteMediaUrl(DEFAULT_OG_IMAGE)

  return {
    '@context': 'https://schema.org',
    '@graph': [
      /* ── 1. Organization + SportsOrganization ── */
      {
        '@type': ['SportsOrganization', 'Organization', 'LocalBusiness'],
        '@id': `${homepageUrl}#organization`,
        name: 'Sports Karate Do Fitness and Self-Defense Association',
        alternateName: ['SKF', 'SKF Karate', 'SKF India', 'SKF Karnataka', 'SKF Bangalore', 'SKF Kunigal', 'Sports Karate Fitness Association', 'SKF Karate Association', 'SKF Karate Federation'],
        url: homepageUrl,
        logo: {
          '@type': 'ImageObject',
          url: logoUrl,
          width: 512,
          height: 512,
        },
        image: imageUrl,
        description:
          "Sports Karate Do Fitness and Self-Defense Association (SKF) is India's #1 karate association and Karnataka's premier karate organization. SKF is India's first fully digital karate association, providing every student with a personal digital profile, live association ranking, complete history tracking of tournaments and achievements, and belt grading records — all preserved digitally. We offer professional karate-do training, national-level karate tournament hosting, self-defense programs, and martial arts fitness courses across Bangalore (Herohalli, Anjanagar, Ullal Nagar), Kunigal, and all of Karnataka.",
        sport: 'Karate',
        foundingDate: String(SITE_CONFIG.FOUNDED_YEAR),
        foundingLocation: {
          '@type': 'Place',
          name: 'Karnataka, India',
        },
        areaServed: [
          { '@type': 'Country', name: 'India' },
          { '@type': 'State', name: 'Karnataka' },
          { '@type': 'City', name: 'Bangalore' },
          { '@type': 'City', name: 'Bengaluru' },
          { '@type': 'City', name: 'Kunigal' },
          { '@type': 'City', name: 'Tumkur' },
          { '@type': 'City', name: 'Hassan' },
        ],
        address: {
          '@type': 'PostalAddress',
          streetAddress: CONTACT.ADDRESS.full,
          addressLocality: 'Bengaluru',
          addressRegion: SITE_CONFIG.STATE,
          postalCode: '560091',
          addressCountry: 'IN',
        },
        geo: {
          '@type': 'GeoCoordinates',
          latitude: '12.9716',
          longitude: '77.5186',
        },
        telephone: CONTACT.PHONE,
        email: CONTACT.EMAIL,
        sameAs: [SOCIAL_LINKS.FACEBOOK, SOCIAL_LINKS.INSTAGRAM, SOCIAL_LINKS.YOUTUBE],
        knowsAbout: [
          'Karate', 'Karate-Do', 'Shotokan Karate', 'Kumite', 'Kata', 'Kihon',
          'Self-Defense', 'Martial Arts', 'Sports Fitness', 'Karate Tournaments',
          'Combat Sports', 'Karate for Kids', 'Karate Training', 'Karate Federation',
          'Belt Grading', 'Black Belt', 'Kobudo', 'Bunkai', 'WKF Karate',
        ],
        keywords:
          'SKF karate, karate India, Karnataka karate, Bangalore karate, Kunigal karate, Herohalli karate, Anjanagar karate, Ullal Nagar karate, digital karate association, student karate ranking, karate history tracking, best karate association India, number one karate Karnataka, karate tournament India, self-defense Karnataka, martial arts Bangalore',
        slogan: "India's #1 Digital Karate Association — Where Every Student's Journey is Tracked and Celebrated",
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: 'SKF Karate Programs & Benefits',
          itemListElement: [
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Digital Student Profile & Ranking System',
                description: "Every SKF student receives a personal digital profile within the association, complete with a live ranking, full grading history, tournament records, and achievement archives. India's only karate association offering full digital student tracking.",
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Professional Karate Training',
                description: 'Expert karate-do training for all levels — white belt to black belt. Kata, kumite, kihon, and practical application training under nationally certified coaches.',
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Karate Tournament Organization & Participation',
                description: 'SKF organizes and participates in district, state, and national karate championships. Students have a clear pathway to compete at the highest levels.',
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Self-Defense Training',
                description: 'Practical, effective self-defense classes for women, children, and adults. Karate-based techniques for real-world safety.',
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Karate for Kids & Juniors',
                description: 'Specialized junior karate programs building discipline, confidence, focus, and fitness in children aged 5 and above. White belt to black belt junior track.',
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Karate Fitness Program',
                description: 'Martial arts-based fitness for strength, agility, flexibility, and cardiovascular health. Combat sports conditioning for all age groups.',
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Belt Grading & Digital Certification',
                description: "Official belt grading from white belt through all colored belts to black belt (dan grades). All certifications and grading history stored digitally in the student's profile.",
              },
            },
          ],
        },
        openingHoursSpecification: [
          {
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
            opens: '06:00',
            closes: '21:00',
          },
        ],
        priceRange: '₹₹',
        hasMap: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(CONTACT.ADDRESS.full)}`,
      },

      /* ── 2. WebSite + SearchAction + Speakable ── */
      {
        '@type': 'WebSite',
        '@id': `${homepageUrl}#website`,
        name: 'SKF – Sports Karate Do Fitness and Self-Defense Association',
        alternateName: 'SKF Karate India',
        url: homepageUrl,
        description:
          "India's #1 Karate Association. SKF – Sports Karate Do Fitness and Self-Defense Association. Digital student tracking, live rankings, karate training, tournaments, self-defense, and fitness programs across Karnataka, Bangalore, and Kunigal.",
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${homepageUrl.replace(/\/$/, '')}/search?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
        inLanguage: 'en-IN',
        publisher: {
          '@id': `${homepageUrl}#organization`,
        },
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector: ['.abt-hero__title', '.abt-hero__subtitle', '.home-hero-text']
        }
      },

      /* ── 3. FAQ Schema (V2 Enhanced) ── */
      {
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'What makes SKF different from other karate associations in India?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: "SKF – Sports Karate Do Fitness and Self-Defense Association is India's first and only fully digital karate association. Every student enrolled at SKF receives a personal digital profile within the association, complete with a live ranking in the association, full grading history, tournament participation records, and a permanent archive of past achievements. No paper records are ever lost. Students can track their complete journey from white belt to black belt — and beyond. This transparent, technology-driven approach to karate makes SKF unique not just in Karnataka but across all of India.",
            },
          },
          {
            '@type': 'Question',
            name: 'Does SKF track student rankings and achievements digitally?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: "Yes. SKF operates a unique digital student management system where every student has their own profile, live ranking within the association, and a complete digital history of all gradings, belt levels, tournament results, and achievements. This makes SKF India's most transparent and technologically advanced karate association. Students and parents can always access a clear, up-to-date record of the student's progress.",
            },
          },
          {
            '@type': 'Question',
            name: 'What is the best karate association in India?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: "Sports Karate Do Fitness and Self-Defense Association (SKF) is widely recognized as India's #1 karate association. SKF combines traditional karate excellence with modern digital management — each student receives a personal digital profile with live rankings, grading history, and achievement tracking. With branches across Karnataka, Bangalore, and Kunigal, SKF trains students from white belt to black belt and produces champions at district, state, and national levels.",
            },
          },
          {
            '@type': 'Question',
            name: 'Which is the number one karate club in Karnataka?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: "SKF – Sports Karate Do Fitness and Self-Defense Association is Karnataka's premier and number one karate club, headquartered in Kunigal with branches across Bangalore and the entire state of Karnataka.",
            },
          },
          {
            '@type': 'Question',
            name: 'Does SKF conduct karate tournaments?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes. SKF organizes and participates in karate tournaments at multiple levels including district championships, state-level competitions, and national karate championships. Students enrolled at SKF have a clear competitive pathway from local tournaments to the highest levels of Indian karate competition. SKF also hosts open karate championships and inter-school tournaments across Karnataka.',
            },
          },
          {
            '@type': 'Question',
            name: 'What is SKF Karate?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: "SKF stands for Sports Karate Do Fitness and Self-Defense Association. It is India's top karate organization offering professional karate-do training, competitive karate tournaments, self-defense programs, and martial arts fitness courses. SKF is Karnataka's most respected karate federation.",
            },
          },
          {
            '@type': 'Question',
            name: 'How can I join karate classes at SKF?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: "You can join SKF karate classes by visiting the official SKF website at skfkarate.org, calling the nearest SKF branch, or walking into any SKF dojo in Bangalore or Kunigal. SKF offers beginner to advanced karate training for all age groups.",
            },
          },
          {
            '@type': 'Question',
            name: 'Does SKF offer karate classes for kids in Bangalore?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes. SKF has specialized junior karate programs for children in Bangalore. The program builds discipline, confidence, focus, and physical fitness in children from age 5 and above, taking them through a structured curriculum from white belt to black belt. Kids karate is available at SKF branches across Herohalli, Anjanagar, Ullal Nagar, and other Bangalore locations.',
            },
          },
          {
            '@type': 'Question',
            name: 'Does SKF offer self-defense classes?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes. SKF provides practical self-defense training for women, children, and adults as a core part of its programs. The self-defense courses are based on proven karate-do techniques and are available at all SKF branches across Karnataka.',
            },
          },
          {
            '@type': 'Question',
            name: 'Where is SKF karate located?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'SKF – Sports Karate Do Fitness and Self-Defense Association has branches across Bangalore including Herohalli, Anjanagar, and Ullal Nagar, as well as its headquarters in Kunigal, Karnataka. Contact SKF to find the nearest branch to your area in Bangalore or elsewhere in Karnataka.',
            },
          },
          {
            '@type': 'Question',
            name: 'Which is the best karate class in Herohalli Bangalore?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: "SKF – Sports Karate Do Fitness and Self-Defense Association offers karate training in Herohalli, Bangalore. SKF is India's #1 karate association and Karnataka's premier karate club, serving students in Herohalli, Anjanagar, Magadi Road, Sunkadakatte, and nearby areas of West Bangalore.",
            },
          },
          {
            '@type': 'Question',
            name: "How does SKF's student ranking system work?",
            acceptedAnswer: {
              '@type': 'Answer',
              text: "SKF operates a unique, fully digital student ranking system. Every student enrolled at SKF is assigned a rank within the association based on their belt level, grading performance, and tournament achievements. This rank is updated in real time as students progress. Unlike traditional associations, SKF's transparent ranking allows students and parents to always know exactly where a student stands, providing motivation and a clear path for improvement. The entire history — every belt grading, every tournament result — is permanently stored in the student's digital profile.",
            },
          },
          {
            '@type': 'Question',
            name: 'What are the benefits of joining SKF karate?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'SKF membership benefits include: (1) Personal digital student profile with live ranking in the association, (2) Complete digital history tracking of all gradings, tournaments, and achievements, (3) Professional karate training from white belt to black belt under certified instructors, (4) Access to district, state, and national karate tournaments, (5) Practical self-defense training, (6) Specialized kids karate programs, (7) Karate fitness and conditioning, (8) Official belt grading and certification, and (9) Membership in India\'s most organized and technology-driven karate association.',
            },
          },
        ],
      },

      /* ── 4. Branch LocalBusiness — Herohalli ── */
      {
        '@type': ['SportsActivityLocation', 'LocalBusiness'],
        name: 'SKF Karate — Herohalli Branch, Bangalore',
        description:
          "SKF Sports Karate Do Fitness and Self-Defense Association — Herohalli, Bangalore. India's #1 karate association brings world-class karate training, self-defense classes, and kids karate programs to Herohalli, Anjanagar, Magadi Road, Sunkadakatte, and surrounding areas of West Bangalore.",
        url: absoluteSiteUrl('/classes/bangalore/herohalli'),
        telephone: CONTACT.PHONE,
        address: {
          '@type': 'PostalAddress',
          streetAddress: CONTACT.ADDRESS.full,
          addressLocality: 'Herohalli',
          addressRegion: 'Karnataka',
          postalCode: '560091',
          addressCountry: 'IN',
        },
        geo: {
          '@type': 'GeoCoordinates',
          latitude: '12.9716',
          longitude: '77.5186',
        },
        openingHoursSpecification: [
          {
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
            opens: '06:00',
            closes: '21:00',
          },
        ],
        priceRange: '₹₹',
        parentOrganization: { '@id': `${homepageUrl}#organization` },
        keywords: 'karate Herohalli, karate classes Herohalli, martial arts Herohalli, self-defense Herohalli Bangalore, karate near Anjanagar, karate Magadi Road, karate Sunkadakatte, SKF Herohalli, best karate West Bangalore',
      },

      /* ── 5. Branch LocalBusiness — MPSC / Ullal ── */
      {
        '@type': ['SportsActivityLocation', 'LocalBusiness'],
        name: 'SKF Karate — M P Sports Club Branch, Bangalore',
        description:
          "SKF Sports Karate Do Fitness and Self-Defense Association — M P Sports Club, Bangalore. Expert karate training, kumite and kata coaching, women's self-defense, and junior karate programs in Mallathahalli and surrounding South-West Bangalore areas.",
        url: absoluteSiteUrl('/classes/bangalore/mp-sports-club'),
        telephone: CONTACT.PHONE,
        address: {
          '@type': 'PostalAddress',
          streetAddress: CONTACT.HQ_ADDRESS,
          addressLocality: 'Mallathahalli',
          addressRegion: 'Karnataka',
          postalCode: '560056',
          addressCountry: 'IN',
        },
        priceRange: '₹₹',
        parentOrganization: { '@id': `${homepageUrl}#organization` },
        keywords: 'karate Mallathahalli Bangalore, karate classes Ullal Nagar, martial arts Ullal Nagar, self-defense Ullal Nagar, SKF Ullal Nagar, karate near Ullal Nagar, karate Baby Colony',
      },

      /* ── 6. Branch LocalBusiness — Anjanagar ── */
      {
        '@type': ['SportsActivityLocation', 'LocalBusiness'],
        name: 'SKF Karate — Anjanagar Branch, Bangalore',
        description:
          "SKF Sports Karate Do Fitness and Self-Defense Association — Anjanagar, Bangalore. High-quality karate-do classes for kids, adults, and professional karateka in the heart of Anjanagar.",
        url: absoluteSiteUrl('/classes/bangalore/anjanagar'),
        telephone: CONTACT.PHONE,
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Anjanagar',
          addressLocality: 'Bengaluru',
          addressRegion: 'Karnataka',
          postalCode: '560091',
          addressCountry: 'IN',
        },
        priceRange: '₹₹',
        parentOrganization: { '@id': `${homepageUrl}#organization` },
        keywords: 'karate Anjanagar Bangalore, karate classes Anjanagar, SKF Anjanagar',
      },

      /* ── 7. Branch LocalBusiness — Kunigal HQ ── */
      {
        '@type': ['SportsActivityLocation', 'LocalBusiness'],
        name: 'SKF Karate — Kunigal Headquarters',
        description:
          "Headquarters of SKF Sports Karate Do Fitness and Self-Defense Association in Kunigal, Karnataka. Premier martial arts and karate training center serving Tumkur district.",
        url: absoluteSiteUrl('/classes/kunigal/kunigal'),
        telephone: CONTACT.PHONE,
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Kunigal Main',
          addressLocality: 'Kunigal',
          addressRegion: 'Karnataka',
          postalCode: '572130',
          addressCountry: 'IN',
        },
        priceRange: '₹₹',
        parentOrganization: { '@id': `${homepageUrl}#organization` },
        keywords: 'karate Kunigal, best karate Kunigal, martial arts Kunigal, SKF Kunigal HQ',
      },
    ],
  }
}

/* ══════════════════════════════════════════════════════════════
   JSON-LD — Breadcrumb + FAQ utilities
   ══════════════════════════════════════════════════════════════ */

export function buildBreadcrumbJsonLd(name: string, path: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: absoluteSiteUrl('/'),
      },
      {
        '@type': 'ListItem',
        position: 2,
        name,
        item: absoluteSiteUrl(path),
      },
    ],
  }
}

export function buildFaqJsonLd(items: Array<{ question: string; answer: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}

/* ══════════════════════════════════════════════════════════════
   JSON-LD — SportsEvent (for tournament/event pages)
   ══════════════════════════════════════════════════════════════ */

export function buildSportsEventJsonLd(event: {
  name: string
  description: string
  startDate: string
  endDate?: string
  venue: string
  city: string
  url: string
  image?: string
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: event.name,
    description: event.description,
    startDate: event.startDate,
    endDate: event.endDate || event.startDate,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: event.venue,
      address: {
        '@type': 'PostalAddress',
        addressLocality: event.city,
        addressRegion: 'Karnataka',
        addressCountry: 'IN',
      },
    },
    organizer: {
      '@id': `${absoluteSiteUrl('/')}#organization`,
    },
    sport: 'Karate',
    url: absoluteSiteUrl(event.url),
    image: event.image ? absoluteMediaUrl(event.image) : absoluteMediaUrl(DEFAULT_OG_IMAGE),
  }
}
