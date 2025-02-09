import { Button } from "~/modules/components/ui/button";

export default function Component() {
  return (
    <div>
      <p>This is a test page (check the console for errors).</p>
      <Button
        onClick={() => {
          throw new Error("This is a test error from an onclick event handler");
        }}
      >
        Throw error
      </Button>
    </div>
  );
}
