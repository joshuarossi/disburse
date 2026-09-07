import { userErrorMessage } from '@/lib/userErrors';
import { useRef, useState } from "react";

export function useLicenseCommand() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const lock = useRef(false),
    request = useRef<{ fingerprint: string; id: string } | undefined>(
      undefined,
    );
  const run = async (
    input: object,
    task: (requestId: string) => Promise<void>,
    message: string,
  ) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const fingerprint = JSON.stringify(input);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, id: crypto.randomUUID() };
      await task(request.current.id);
      request.current = undefined;
      setSuccess(message);
    } catch (error) {
      setError(
        userErrorMessage(error, "The license change could not be saved."),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { busy, error, success, run };
}
