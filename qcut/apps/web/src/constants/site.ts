export const SITE_URL = "https://qcut.app";

export const SITE_INFO = {
  title: "QCut",
  description:
    "A simple but powerful video editor that gets the job done. In your browser.",
  url: SITE_URL,
  openGraphImage: "/open-graph/default.jpg",
  twitterImage: "/open-graph/default.jpg",
  favicon: "/favicon.ico",
};

export const EXTERNAL_TOOLS = [
  {
    name: "Marble",
    description:
      "Modern headless CMS for content management and the blog for QCut",
    url: "https://marblecms.com?utm_source=qcut",
    icon: "MarbleIcon" as const,
  },
  {
    name: "Vercel",
    description: "Platform where we deploy and host QCut",
    url: "https://vercel.com?utm_source=qcut",
    icon: "VercelIcon" as const,
  },
  {
    name: "Databuddy",
    description: "GDPR compliant analytics and user insights for QCut",
    url: "https://databuddy.cc?utm_source=qcut",
    icon: "DataBuddyIcon" as const,
  },
];
