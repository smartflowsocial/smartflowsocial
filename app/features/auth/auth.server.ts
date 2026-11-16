export {
  getUser,
  getUserId,
  getSessionId,
  getSessionPubkey,
  requireUserId,
  requireUser,
  requireSession,
  logout,
  createUserSession,
} from "./session.server";

export {
  refreshUserProfileIfEmpty,
  refreshUserProfileIfChanged,
} from "./profile.server";
export { updateUserProfile } from "~/features/user";

export {
  issueLoginChallenge,
  getLoginChallengeForVerify,
  consumeLoginChallengeAndCreateSession,
} from "./services/nostr-auth.server";
