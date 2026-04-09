type PromiseHash = Record<string, Promise<unknown>>;

type AwaitedPromiseHash<T extends PromiseHash> = {
  [P in keyof T]: Awaited<T[P]>;
};

export namespace PromiseUtils {
  export async function allObjects<T extends PromiseHash>(object: T): Promise<AwaitedPromiseHash<T>> {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(object).map(async ([key, promise]) => {
          return [key, await promise];
        })
      )
    );
  }

  export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
