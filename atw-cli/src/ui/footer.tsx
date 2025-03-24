import type { schema } from "@lib/zero-sync/schema";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Newline, Text, Box } from "ink";
import Link from "ink-link";
import { useEffect, useState } from "react";
import { colors } from "./theme";
import { Spinner } from "@inkjs/ui";

export const Footer = () => {
  const z = useZero<typeof schema>();
  const [speakers] = useQuery(z.query.profiles);
  const [speakerIndex, setSpeakerIndex] = useState(
    Math.floor(Math.random() * 10) + 1,
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setSpeakerIndex((speakerIndex + 1) % speakers.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [speakerIndex, speakers.length]);

  const speaker = speakers[speakerIndex];

  const link = (() => {
    if (speaker?.linkedinHandle) {
      return `https://www.linkedin.com/in/${speaker.linkedinHandle}`;
    }
    if (speaker?.twitterHandle) {
      return `https://x.com/${speaker.twitterHandle}`;
    }
    if (speaker?.blueskyHandle) {
      return `https://bsky.app/profile/${speaker.blueskyHandle}`;
    }
  })();
  return (
    <>
      <Newline />
      <Text dimColor>------------------------ </Text>
      <Box>
        {!speaker && <Spinner type="dots10" label="Loading speakers..." />}
        {speaker && (
          <Text italic dimColor>
            <Text>
              {speaker.name} -{" "}
              <Text color={colors.mainOrange} dimColor>
                {speaker?.title}
              </Text>
              <Newline />
              {link && (
                <Link url={link}>
                  <Text color={colors.mainOrange} dimColor>
                    {link}
                  </Text>
                </Link>
              )}
            </Text>
          </Text>
        )}
      </Box>
    </>
  );
};
