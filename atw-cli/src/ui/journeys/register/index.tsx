import { Box, Text } from "ink"
import { useReducer } from "react"
import { Select } from "../../components/select"
import { Badge, EmailInput, Spinner } from '@inkjs/ui';

import { registerAction, type Event } from "../../../actions/register"
import Link from "ink-link";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { schema } from "@lib/zero-sync/schema";
import { colors } from "../../theme";
import { initialState, reducer, toDate } from "./core";
import { ATW_BASEURL } from "../../../config";

type RegisterJourneyProps = {
    unmount: () => void
}

export const RegisterJourney = ({ unmount }: RegisterJourneyProps) => {
    const z = useZero<typeof schema>();
    const [events] = useQuery(z.query.events.where('startDate', '>', (new Date()).getTime()).orderBy('startDate', 'desc').limit(10))
    const [state, dispatch] = useReducer(reducer, initialState);
    const { event, hasSucceeded, isSubmitting, error } = state
    const isLoading = events.length <= 0
    return <Box flexDirection="column" padding={1}>
        {isLoading && <Spinner type='aesthetic' label="Loading events..." />}
        {!event && !isLoading && <Text>Here is the list of the upcomping events:</Text>}
        {!event && <Select<Event> options={events.map((event) => {
            const link = `${ATW_BASEURL}/${event.slug}`
            return {
                label: event.name,
                value: event,
                render: (label, value, isSelected) => <Box>
                    <Box flexDirection="column">
                        <Text bold={isSelected} color={isSelected ? colors.mainPurple : undefined} dimColor={!isSelected}>{label}</Text>
                        <Text dimColor={!isSelected}>{toDate(event.startDate)} - {value.shortLocation}</Text>
                        <Link url={link}>
                            <Text color={colors.mainBlue} dimColor={!isSelected}>{link}</Text>
                        </Link>
                    </Box>
                </Box>
            }
        })} onSelect={(event) => {
            dispatch({ type: 'SELECT_EVENT', event })
        }} />}

        {event && <Box flexDirection="column" padding={1} gap={1}>
            <Box flexDirection="column">
                <Text bold color={colors.mainPurple}>{event.name}</Text>
                <Text>{toDate(event.startDate)} - {event.shortLocation}</Text>
                <Link url={`${ATW_BASEURL}/${event.slug}`}>
                    <Text color={colors.mainBlue}>{`${ATW_BASEURL}/${event.slug}`}</Text>
                </Link>
            </Box>

            {hasSucceeded === null && !isSubmitting && <>
                <Text>To finalize registration, please enter your email address:</Text>
                <EmailInput
                    domains={['gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'hotmail.com', 'protonmail.com']}
                    placeholder="Your email..."
                    onSubmit={async (email) => {
                        dispatch({ type: 'SET_EMAIL', email })
                        const results = await registerAction(email, event.id)
                        dispatch({ type: 'HANDLE_API_RESULTS', results })
                        setTimeout(() => {
                            unmount()
                        }, 2000)
                    }}
                />
            </>}
        </Box>}
        {isSubmitting && <Box flexDirection="row" gap={2} padding={2}>
            <Badge color="yellow">Registrating...</Badge><Text dimColor>{state.email}</Text><Spinner type='bouncingBall' label="Hang tight!" />
        </Box>}
        {hasSucceeded === true && <Box flexDirection="row" gap={2} padding={2}>
            <Badge color="green">Registration Successful!</Badge><Spinner type='fingerDance' label="See you there" /><Text color={colors.mainOrange}>{state.email}</Text>
        </Box>}
        {hasSucceeded === false && <Box flexDirection="row" gap={2} padding={2}>
            <Badge color="red">Registration Failed!</Badge><Spinner type='monkey' label={error || 'Something went wrong!'} />
        </Box>}
    </Box>
}
