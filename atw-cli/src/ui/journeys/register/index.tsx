import { Box, Newline, Text } from "ink";
import { useEffect, useReducer, useState } from "react";
import { Select } from "../../components/select";
import { Badge, EmailInput, Spinner } from "@inkjs/ui";

import { registerAction, type Event } from "../../../actions/register";
import Link from "ink-link";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { schema } from "@lib/zero-sync/schema";
import { colors } from "../../theme";
import { initialState, reducer, toDate } from "./core";
import { ATW_BASEURL } from "../../../config";
import { generateQrCode } from "../../../helpers/generate-qr-code";
import type { TalkativeBot } from "../../../contracts/talkative-bot-interface";

type RegisterJourneyProps = {
  unmount: () => void;
  deps: {
    tBot: TalkativeBot;
  };
};

export const RegisterJourney = ({
  unmount,
  deps: { tBot },
}: RegisterJourneyProps) => {
  const z = useZero<typeof schema>();
  const [events] = useQuery(
    z.query.events
      .where("startDate", ">", new Date().getTime())
      .orderBy("startDate", "desc")
      .limit(10),
  );
  const [state, dispatch] = useReducer(reducer, initialState);
  const { event, hasSucceeded, isSubmitting, error } = state;
  const isLoading = events.length <= 0;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!event) return;
    generateQrCode(`${ATW_BASEURL}/${event.slug}`).then(setQr).catch();
  }, [event]);

  return (
    <Box flexDirection="column" padding={1}>
      {isLoading && <Spinner type="aesthetic" label="Loading events..." />}
      {!event && !isLoading && (
        <Text>Here is the list of the upcomping events:</Text>
      )}
      {!event && (
        <Select<Event>
          options={events.map((event) => {
            const link = `${ATW_BASEURL}/${event.slug}`;
            return {
              label: event.name,
              value: event,
              render: (label, value, isSelected) => (
                <Box>
                  <Box flexDirection="column">
                    <Text
                      bold={isSelected}
                      color={isSelected ? colors.mainPurple : undefined}
                      dimColor={!isSelected}
                    >
                      {label}
                    </Text>
                    <Text dimColor={!isSelected}>
                      {toDate(event.startDate)} - {value.shortLocation}
                    </Text>
                    <Link url={link}>
                      <Text color={colors.mainBlue} dimColor={!isSelected}>
                        {link}
                      </Text>
                    </Link>
                  </Box>
                </Box>
              ),
            };
          })}
          onSelect={async (event) => {
            dispatch({ type: "SELECT_EVENT", event });
            await tBot.say(
              `You selected ${event.name}. It's happening on ${toDate(event.startDate)} at ${event.shortLocation}.`,
            );
            await tBot.say(event.tagline.split(/\.|\!/).slice(1).join("."));
            await tBot.say(`Please enter your email now.`);
          }}
        />
      )}

      {event && (
        <Box flexDirection="column" padding={1} gap={1}>
          <Box flexDirection="column">
            <Text bold color={colors.mainPurple}>
              {event.name}
            </Text>
            <Text>
              {toDate(event.startDate)} - {event.shortLocation}
            </Text>
            <Link url={`${ATW_BASEURL}/${event.slug}`}>
              <Text
                color={colors.mainBlue}
              >{`${ATW_BASEURL}/${event.slug}`}</Text>
            </Link>
            <Newline />
            <Text>{event.tagline}</Text>
            <Newline />
            <Text color={colors.mainPurple}>{qr}</Text>
          </Box>

          {hasSucceeded === null && !isSubmitting && (
            <>
              <Text>
                To finalize registration, please enter your email address:
              </Text>
              <EmailInput
                domains={[
                  "gmail.com",
                  "yahoo.com",
                  "outlook.com",
                  "icloud.com",
                  "hotmail.com",
                  "protonmail.com",
                ]}
                placeholder="Your email..."
                onSubmit={async (email) => {
                  dispatch({ type: "SET_EMAIL", email });
                  const results = await registerAction(email, event.id);
                  dispatch({ type: "HANDLE_API_RESULTS", results });
                  if (results.success === true) {
                    await tBot.say(`Yeah! You are all set! See you there!`);
                  }
                  if (results.success === false) {
                    await tBot.say(`Oh no! Something went wrong! ${error}`);
                  }
                  setTimeout(() => {
                    unmount();
                  }, 2000);
                }}
              />
            </>
          )}
        </Box>
      )}
      {isSubmitting && (
        <Box flexDirection="row" gap={2} padding={2}>
          <Badge color="yellow">Registrating...</Badge>
          <Text dimColor>{state.email}</Text>
          <Spinner type="bouncingBall" label="Hang tight!" />
        </Box>
      )}
      {hasSucceeded === true && (
        <Box flexDirection="row" gap={2} padding={2}>
          <Badge color="green">Registration Successful!</Badge>
          <Spinner type="fingerDance" label="See you there" />
        </Box>
      )}

      {hasSucceeded === false && (
        <Box flexDirection="row" gap={2} padding={2}>
          <Badge color="red">Registration Failed!</Badge>
          <Spinner type="monkey" label={error || "Something went wrong!"} />
        </Box>
      )}
    </Box>
  );
};
