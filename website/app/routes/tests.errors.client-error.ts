import { useEffect } from "react";

export default function Component() {
  useEffect(() => {
    throw new Error(
      "This is a test error from a React component during render"
    );
  }, []);
  return "This is a test page";
}
