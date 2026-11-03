// Broad, human-friendly industry buckets for the Companies list filter chips.
//
// A company's `industry` is free text and often granular (e.g. "Construction
// Manager", "General Contractor"), which fragments the filter bar into dozens of
// near-duplicate chips. We roll each raw value up into ONE of these natural
// categories by keyword match so the chips stay short and readable. This is purely
// a presentation/filter grouping: the company's own specific industry text is
// untouched and still shown on its row, and the add/edit datalist still suggests
// the raw distinct values (so free-text entry keeps working).
//
// Matching is first-category-wins over a lowercased substring test, so ORDER
// MATTERS: a bucket is listed before any later bucket whose keywords could also
// catch its values. For example Finance sits before Consulting so "financial
// advisory" lands in Finance, and Healthcare/Education sit before Technology so
// "biotech"/"edtech" don't get swallowed by the bare "tech" keyword. Anything with
// no keyword hit (including an empty string) falls to "Other".
//
// Tenant-neutral and meant to be adjusted — add buckets or keywords freely.

type IndustryCategory = { label: string; keywords: readonly string[] };

export const OTHER_INDUSTRY_CATEGORY = "Other";

export const INDUSTRY_CATEGORIES: readonly IndustryCategory[] = [
  {
    label: "Construction",
    keywords: [
      "construct",
      "contractor",
      "contracting",
      "general contract",
      "builder",
      "building",
      "masonry",
      "roofing",
      "hvac",
      "plumbing",
      "electrical",
      "electrician",
      "excavat",
      "concrete",
      "paving",
      "carpentry",
      "remodel",
      "drywall",
    ],
  },
  {
    label: "Architecture & Engineering",
    keywords: ["architect", "engineering", "engineer", "surveying", "surveyor", "geotechnical"],
  },
  {
    label: "Real Estate",
    keywords: [
      "real estate",
      "realty",
      "realtor",
      "property management",
      "property",
      "leasing",
      "appraisal",
    ],
  },
  {
    label: "Finance",
    keywords: [
      "financ",
      "bank",
      "credit union",
      "capital",
      "investment",
      "investing",
      "wealth",
      "private equity",
      "venture",
      "asset management",
      "lending",
      "mortgage",
      "fintech",
    ],
  },
  { label: "Insurance", keywords: ["insurance", "insurer", "underwriting"] },
  {
    label: "Accounting",
    keywords: ["accounting", "accountant", "cpa", "bookkeeping", "audit"],
  },
  {
    label: "Legal",
    keywords: ["legal", "law firm", "law office", "attorney", "lawyer", "litigation", "paralegal"],
  },
  {
    label: "Healthcare & Life Sciences",
    keywords: [
      "health",
      "medical",
      "medtech",
      "hospital",
      "clinic",
      "life science",
      "pharma",
      "biotech",
      "dental",
      "nursing",
      "physician",
      "therapy",
      "wellness",
      "home care",
      "senior care",
    ],
  },
  {
    label: "Education",
    keywords: [
      "education",
      "school",
      "university",
      "college",
      "academy",
      "edtech",
      "e-learning",
      "tutoring",
      "training",
    ],
  },
  {
    label: "Manufacturing",
    keywords: [
      "manufactur",
      "factory",
      "industrial",
      "fabrication",
      "machining",
      "machine shop",
      "foundry",
      "metalworking",
      "plastics",
      "packaging",
      "mill",
    ],
  },
  {
    label: "Technology",
    keywords: [
      "technology",
      "tech",
      "software",
      "saas",
      "information technology",
      "cybersecurity",
      "cyber",
      "artificial intelligence",
      "data analytics",
      "cloud",
      "computer",
      "managed services",
      "msp",
    ],
  },
  {
    label: "Marketing & Media",
    keywords: [
      "marketing",
      "advertising",
      "ad agency",
      "public relations",
      "branding",
      "media",
      "publishing",
      "broadcast",
      "creative agency",
      "social media",
      "graphic design",
    ],
  },
  { label: "Consulting", keywords: ["consulting", "consultant", "advisory"] },
  {
    label: "Energy & Utilities",
    keywords: [
      "energy",
      "solar",
      "renewable",
      "power",
      "utility",
      "utilities",
      "oil and gas",
      "natural gas",
      "wind energy",
      "electric utility",
    ],
  },
  {
    label: "Transportation & Logistics",
    keywords: [
      "transport",
      "logistics",
      "shipping",
      "freight",
      "trucking",
      "warehous",
      "distribution",
      "supply chain",
      "courier",
      "fleet",
    ],
  },
  {
    label: "Agriculture & Food",
    keywords: [
      "agricult",
      "farm",
      "agri",
      "food production",
      "food and beverage",
      "food & beverage",
      "dairy",
      "winery",
      "vineyard",
      "brewery",
      "cannabis",
      "orchard",
      "produce",
    ],
  },
  {
    label: "Hospitality & Tourism",
    keywords: [
      "hospitality",
      "hotel",
      "restaurant",
      "catering",
      "caterer",
      "tourism",
      "resort",
      "lodging",
      "food service",
      "travel",
    ],
  },
  {
    label: "Retail & Consumer",
    keywords: [
      "retail",
      "retailer",
      "e-commerce",
      "ecommerce",
      "consumer goods",
      "consumer products",
      "apparel",
      "boutique",
      "grocery",
    ],
  },
  {
    label: "Nonprofit & Government",
    keywords: [
      "nonprofit",
      "non-profit",
      "not-for-profit",
      "foundation",
      "charity",
      "ngo",
      "government",
      "municipal",
      "public sector",
      "economic development",
      "chamber",
      "association",
    ],
  },
];

// Roll a free-text industry up into its broad category (first keyword hit wins);
// anything unmatched or empty is "Other".
export function categorizeIndustry(raw: string): string {
  const text = raw.toLowerCase();
  if (text.trim() === "") return OTHER_INDUSTRY_CATEGORY;
  for (const category of INDUSTRY_CATEGORIES)
    if (category.keywords.some((keyword) => text.includes(keyword)))
      return category.label;
  return OTHER_INDUSTRY_CATEGORY;
}
