import { requireAnySubscription } from "~/features/payments";
import { loadTemplatesData } from "~/features/templates";
import { validateLoaderResponse } from "~/lib/validation/loader-responses.server";
import {
  templatesLoaderDataSchema,
  type TemplatesLoaderData,
} from "~/lib/validation/schemas/loader-responses.schemas";

export async function loadTemplatesValidated(
  userId: string
): Promise<TemplatesLoaderData> {
  await requireAnySubscription(userId);
  const data = await loadTemplatesData(userId);
  return validateLoaderResponse(data, templatesLoaderDataSchema);
}
