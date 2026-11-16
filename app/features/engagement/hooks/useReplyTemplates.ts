import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

export interface ReplyTemplate {
  id: string;
  slug: string;
  body: string;
}

const API = "/api/engagement/reply-templates";

interface FetcherData {
  templates?: ReplyTemplate[];
  success?: boolean;
}

export function useReplyTemplates(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const fetcher = useFetcher<FetcherData>();
  const fetcherRef = useRef(fetcher);
  const [templates, setTemplates] = useState<ReplyTemplate[]>([]);
  const didMutateRef = useRef(false);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const load = useCallback(() => {
    if (enabled) {
      didMutateRef.current = false;
      void fetcherRef.current.load(API);
    }
  }, [enabled]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.templates) {
      const next = Array.isArray(fetcher.data.templates)
        ? fetcher.data.templates
        : [];
      setTimeout(() => setTemplates(next), 0);
    }
    if (didMutateRef.current && fetcher.data.success) {
      didMutateRef.current = false;
      void fetcher.load(API);
    }
  }, [fetcher.state, fetcher.data, fetcher]);

  const createTemplate = useCallback(
    (slug: string, body: string) => {
      didMutateRef.current = true;
      void fetcher.submit(
        { action: "create", slug, body },
        { method: "POST", action: API, encType: "application/json" }
      );
    },
    [fetcher]
  );

  const deleteTemplate = useCallback(
    (id: string) => {
      didMutateRef.current = true;
      void fetcher.submit(
        { action: "delete", id },
        { method: "POST", action: API, encType: "application/json" }
      );
    },
    [fetcher]
  );

  return {
    templates,
    isLoading: fetcher.state === "loading",
    load,
    createTemplate,
    deleteTemplate,
  };
}
