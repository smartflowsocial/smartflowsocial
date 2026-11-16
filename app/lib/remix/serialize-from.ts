import type { UNSAFE_DataWithResponseInit } from "react-router";

type DataFrom<T> = T extends (...args: never[]) => infer R ? Awaited<R> : T;

type Unwrap<T> =
  T extends UNSAFE_DataWithResponseInit<infer U>
    ? U
    : T extends Response
      ? never
      : T;

/** Loader and action values after React Router strips `Response` and `data()`. */
export type SerializeFrom<T> = Unwrap<DataFrom<T>>;
