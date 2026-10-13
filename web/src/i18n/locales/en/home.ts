// Home, Projects and Community pages + the hero composer (PromptBox) and ProjectCard.
export const home = {
  greeting: {
    title: 'What shall we build, {name}?',
    titleNoName: 'What shall we build today?',
    subtitle: 'Describe your idea in plain words. Yasa turns it into a working app or website in minutes.',
  },

  prompt: {
    label: 'Describe what you want to build',
    placeholder1: 'Build a landing page for my coffee shop with a menu and a map…',
    placeholder2: 'Create a wedding invitation site with a countdown and an RSVP form…',
    placeholder3: 'Make a dashboard that tracks my monthly expenses…',
    placeholder4: 'Design a course catalogue for a learning centre with enrolment…',
    placeholder5: 'Build a landing page for my Telegram channel with a Subscribe button…',
    submit: 'Start building',
    creating: 'Creating your project…',
    attach: 'Attach images',
    attachGuest: 'Sign up to attach images',
    attachLimit: 'You can attach up to {max} images',
    removeAttachment: 'Remove “{name}”',
    dropHint: 'Drop images here to attach them',
    uploading: 'Uploading…',
    uploadFailed: 'Could not upload “{name}”',
    onlyImages: 'Only PNG, JPEG, WebP and GIF images can be attached',
    waitUploads: 'Wait until the images finish uploading',
    hint: 'Press Enter to send, Shift + Enter for a new line',
    examplesLabel: 'Or start from an idea',
  },

  examples: {
    wedding: {
      label: 'Wedding invitation',
      prompt:
        'Build an elegant wedding invitation website: the couple’s names, the date and venue with a map, a live countdown, the programme of the day, a photo gallery and an RSVP form.',
    },
    teahouse: {
      label: 'Teahouse menu',
      prompt:
        'Build a menu website for a traditional teahouse (choyxona): dishes grouped by category with photos and prices in soʻm, a “dish of the day” block, opening hours, the address and a button to call for a table.',
    },
    courses: {
      label: 'Learning centre courses',
      prompt:
        'Build a website for a learning centre: a catalogue of courses (English, IT, maths) with levels, schedule and prices, teacher profiles, student reviews and an enrolment form for a free trial lesson.',
    },
    telegram: {
      label: 'Telegram channel landing',
      prompt:
        'Build a landing page for a Telegram channel: a bold headline, what subscribers get, a few sample posts, subscriber statistics, reviews and a large “Subscribe on Telegram” button.',
    },
    portfolio: {
      label: 'Personal portfolio',
      prompt:
        'Build a personal portfolio for a designer: a short intro, a grid of projects with detail pages, an “About me” section, a list of skills and a contact form.',
    },
    shop: {
      label: 'Online shop',
      prompt:
        'Build a small online shop for handmade ceramics: a product grid with filters, a product page, a cart with a total and a simple checkout form.',
    },
  },

  demo: {
    text: 'Demo mode: replies are pre-written.',
    action: 'Connect a free AI key (2 min)',
  },

  pending: {
    creating: 'Creating a project from your idea…',
  },

  recent: {
    title: 'Recent projects',
    subtitle: 'Pick up where you left off',
    emptyTitle: 'No projects yet',
    emptyDescription: 'Describe your first idea above and it will appear here.',
    errorTitle: 'Could not load your projects',
  },

  communitySection: {
    title: 'From the community',
    subtitle: 'Open any project to see how it is made, or remix it into your own',
  },

  card: {
    menu: 'Project actions',
    open: 'Open',
    untitled: 'Untitled project',
    updated: 'Updated {time}',
    renamed: 'Project renamed',
    duplicated: 'A copy of “{name}” was created',
    deleted: 'Project deleted',
    deleteTitle: 'Delete “{name}”?',
    deleteDescription:
      'The project, its chat, versions and published site will be permanently deleted. This action cannot be undone.',
  },

  rename: {
    title: 'Rename project',
    description: 'Choose a short name that is easy to recognise.',
    label: 'Project name',
    placeholder: 'My project',
    required: 'Enter a name',
    tooLong: 'The name is too long (max {max} characters)',
  },

  projects: {
    title: 'Projects',
    description: 'Everything you have built with Yasa.',
    new: 'New project',
    searchPlaceholder: 'Search projects…',
    searchLabel: 'Search projects',
    sortLabel: 'Sort by',
    sortUpdated: 'Last updated',
    sortCreated: 'Date created',
    sortName: 'Name',
    emptyTitle: 'No projects yet',
    emptyDescription: 'Create your first project and start building by chatting with AI.',
    noResultsTitle: 'Nothing found',
    noResultsDescription: 'No projects match “{query}”. Try a different search.',
    clearSearch: 'Clear search',
    errorTitle: 'Could not load your projects',
  },

  community: {
    title: 'Community',
    description: 'Apps and websites built by people like you. Open one, look inside, remix it.',
    searchPlaceholder: 'Search the community…',
    searchLabel: 'Search the community',
    sortLabel: 'Sort by',
    sortRecent: 'Newest',
    sortPopular: 'Most remixed',
    by: 'by {name}',
    openApp: 'Open app',
    view: 'View',
    remix: 'Remix',
    remixHint: 'Make your own copy and keep building',
    remixed: 'Remixed. This copy is yours',
    loginToRemix: 'Log in to remix this project',
    emptyTitle: 'The community is just getting started',
    emptyDescription: 'Publish a project and make it public to be the first one here.',
    noResultsTitle: 'Nothing found',
    noResultsDescription: 'No public projects match “{query}”.',
    clearSearch: 'Clear search',
    errorTitle: 'Could not load the community',
    loadMore: 'Load more',
  },
} as const;
