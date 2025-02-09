import { Form } from "react-router";
import { Button } from "~/modules/components/ui/button";
import { captureException } from "~/modules/sentry/capture.server";

export async function action() {
  captureException(new Error("This is a test error from an action function"));
  return {};
}

export default function Component() {
  return (
    <div>
      <p>This is a test page.</p>
      <Form>
        <Button type="submit">Throw error</Button>
      </Form>
    </div>
  );
}
