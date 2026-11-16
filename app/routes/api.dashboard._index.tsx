import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import {
  action as dashboardAction,
  loader as dashboardLoader,
} from "~/routes/dashboard._index";

export const loader = jsonLoader(dashboardLoader);
export const action = jsonAction(dashboardAction);
