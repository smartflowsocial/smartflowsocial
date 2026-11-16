import { redirect } from "react-router";

/**
 * Legacy URL: type picker moved to Templates list (Create template dialog).
 */
export function loader() {
  return redirect("/dashboard/templates?create=1");
}

export default function TemplateNewIndexRedirect() {
  return null;
}
