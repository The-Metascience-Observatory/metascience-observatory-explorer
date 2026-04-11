"use client";

import DOMPurify from "dompurify";

interface PaperTitleProps {
  title: string;
  className?: string;
}

export function PaperTitle({ title, className }: PaperTitleProps) {
  const sanitized = DOMPurify.sanitize(title, {
    ALLOWED_TAGS: ['i'],
    ALLOWED_ATTR: [],
  });

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
