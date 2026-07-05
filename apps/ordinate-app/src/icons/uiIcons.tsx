import type { ReactNode } from "react";

import type { ToolSpec } from "../types/ui";

function ToolbarIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function ViewIcon() {
  return (
    <ToolbarIcon>
      <rect x="2.5" y="4" width="15" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 4v12" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.5 8h1.7M4.5 10.7h1.7M4.5 13.4h1.7" fill="none" stroke="currentColor" strokeLinecap="round" />
    </ToolbarIcon>
  );
}

function InsertIcon() {
  return (
    <ToolbarIcon>
      <rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 6.8v6.4M6.8 10h6.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M15.2 15.2h2.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </ToolbarIcon>
  );
}

function TableGlyph() {
  return (
    <ToolbarIcon>
      <rect x="3" y="4" width="14" height="12" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 8h14M3 12h14M8 4v12M12 4v12" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </ToolbarIcon>
  );
}

function ChartIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M10 3.2a6.8 6.8 0 1 1-4.8 2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
      <path d="M10 3.2V10l4.7 2.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </ToolbarIcon>
  );
}

function TextIcon() {
  return (
    <ToolbarIcon>
      <rect x="2.8" y="4.2" width="14.4" height="11.6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7.1 13.2 9.8 6.8l2.7 6.4M8.1 11h3.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M15.4 8.2h1.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
    </ToolbarIcon>
  );
}

function ShapeIcon() {
  return (
    <ToolbarIcon>
      <rect x="3" y="3.8" width="8.7" height="8.7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="8.4" y="7.2" width="8.6" height="8.8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </ToolbarIcon>
  );
}

function CommentIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M4.2 4.5h11.6a1.8 1.8 0 0 1 1.8 1.8v6.1a1.8 1.8 0 0 1-1.8 1.8H9l-3.6 2.4v-2.4H4.2a1.8 1.8 0 0 1-1.8-1.8V6.3a1.8 1.8 0 0 1 1.8-1.8Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
      <path d="M6.7 8.4h6.6M6.7 11h4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
    </ToolbarIcon>
  );
}

function OrganizeIcon() {
  return (
    <ToolbarIcon>
      <path d="M4 5.2h12M6.2 9.1h7.6M8 13h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <circle cx="15.4" cy="15.3" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </ToolbarIcon>
  );
}

export function PageSetupIcon() {
  return (
    <ToolbarIcon>
      <rect x="3.2" y="3.8" width="13.6" height="12.4" rx="2" fill="none" stroke="currentColor" strokeWidth="1.35" />
      <path d="M3.2 7.4h13.6M7 3.8v12.4" fill="none" stroke="currentColor" strokeWidth="1.15" />
      <path d="M9.8 10.2h4.2M9.8 12.7h2.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
      <circle cx="14.6" cy="14.5" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M14.6 13.5v2M13.6 14.5h2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.05" />
    </ToolbarIcon>
  );
}

export function PlusIcon() {
  return (
    <ToolbarIcon>
      <path d="M10 4.4v11.2M4.4 10h11.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </ToolbarIcon>
  );
}

export function ChevronLeftIcon() {
  return (
    <ToolbarIcon>
      <path d="m12.4 5.4-4.6 4.6 4.6 4.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </ToolbarIcon>
  );
}

export function ChevronRightIcon() {
  return (
    <ToolbarIcon>
      <path d="m7.6 5.4 4.6 4.6-4.6 4.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </ToolbarIcon>
  );
}

export function MoreIcon() {
  return (
    <ToolbarIcon>
      <circle cx="5" cy="10" r="1.2" fill="currentColor" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" />
      <circle cx="15" cy="10" r="1.2" fill="currentColor" />
    </ToolbarIcon>
  );
}

export function UndoIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M8 5.2 4.2 9 8 12.8M4.7 9h7.2a4 4 0 0 1 0 8H10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.55"
      />
    </ToolbarIcon>
  );
}

export function RedoIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M12 5.2 15.8 9 12 12.8M15.3 9H8.1a4 4 0 0 0 0 8H10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.55"
      />
    </ToolbarIcon>
  );
}

export function CodeIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M7.25 5.75 3.5 9.5l3.75 3.75M12.75 5.75 16.5 9.5l-3.75 3.75M11.1 4.5 8.9 14.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </ToolbarIcon>
  );
}

export function OpenIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M3.2 6.2h5l1.5 1.7h7.1v6.6a1.6 1.6 0 0 1-1.6 1.6H4.8a1.6 1.6 0 0 1-1.6-1.6V6.2Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <path d="M3.2 8.2V5.8a1.5 1.5 0 0 1 1.5-1.5h3.2l1.5 1.6h3.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
    </ToolbarIcon>
  );
}

export function SaveIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M4.1 3.6h9.6l2.2 2.3v10.5H4.1V3.6Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <path d="M6.6 3.6v4.2h6.4V3.6M7 13.8h6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" />
    </ToolbarIcon>
  );
}

export function SaveAsIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M4 3.6h9.2l2.1 2.2v10.6H4V3.6Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
      <path d="M6.4 3.6v3.9h6.2V3.6" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.15" />
      <path d="m8 14.1 4.7-4.7 1.9 1.9-4.7 4.7H8v-1.9Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.15" />
    </ToolbarIcon>
  );
}

export function SunIcon() {
  return (
    <ToolbarIcon>
      <circle cx="10" cy="10" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 2.5v2.1M10 15.4v2.1M2.5 10h2.1M15.4 10h2.1M4.6 4.6l1.5 1.5M13.9 13.9l1.5 1.5M15.4 4.6l-1.5 1.5M6.1 13.9l-1.5 1.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </ToolbarIcon>
  );
}

export function MoonIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M12.9 3.1a6.7 6.7 0 1 0 4 11.8A7.4 7.4 0 1 1 12.9 3.1Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </ToolbarIcon>
  );
}

export function AutoIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M10 3.1a6.9 6.9 0 1 0 0 13.8V3.1Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M10 3.1a6.9 6.9 0 0 1 0 13.8"
        fill="currentColor"
        opacity="0.2"
      />
      <path d="M10 2.3v1.3M10 16.4v1.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </ToolbarIcon>
  );
}

export const TOOLBAR_ITEMS: ToolSpec[] = [
  { label: "View", icon: <ViewIcon /> },
  { label: "Insert", icon: <InsertIcon /> },
  { label: "Table", icon: <TableGlyph /> },
  { label: "Chart", icon: <ChartIcon /> },
  { label: "Text", icon: <TextIcon /> },
  { label: "Shape", icon: <ShapeIcon /> },
  { label: "Comment", icon: <CommentIcon /> },
  { label: "Organize", icon: <OrganizeIcon /> },
];
