import { Box, Text } from "ink"
import { useState } from "react"
import { Select } from "./components/select"
import { EmailInput, Spinner } from '@inkjs/ui';

import { registerAction, type Event } from "../actions/register.action"
import Link from "ink-link";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { schema } from "@lib/zero-sync/schema";

type RegisterJourneyProps = {
    unmount: () => void
}

const toDate = (date: string) => `${new Date(date).toLocaleDateString()} ${new Date(date).toLocaleTimeString()}`

export const RegisterJourney = ({ unmount }: RegisterJourneyProps) => {
    const z = useZero<typeof schema>();
    
    //where('startDate', '>', now.toUTCString())
    const eventQuery = z.query.events.orderBy('startDate', 'desc').limit(10);
    const [events] = useQuery(eventQuery);
    const [event, setEvent] = useState<Event | null>(null)
    const [hasSucceeded, setHasSucceeded] = useState(false)
    return <Box flexDirection="column" padding={1} gap={1}>

        {!event && <Text>Here is the list of the upcomping events:</Text>}
        {!event && <Select<Event> options={events.map((event) => {
            const link = `https://allthingsweb.dev/${event.slug}`
            return {
                label: event.name,
                value: event,
                render: (label, value, isSelected) => <Box>
                    <Box flexDirection="column">
                        <Text bold={isSelected} dimColor={!isSelected}>{label}</Text>
                        <Text dimColor={!isSelected}>{toDate(event.startDate)} - {value.shortLocation}</Text>
                        <Link url={link}>
                            <Text color={'#FF9900'} dimColor={!isSelected}>{link}</Text>
                        </Link>
                    </Box>
                </Box>
            }
        })} onSelect={(event) => {
            setEvent(event)
        }} />}

        {event && <Box flexDirection="column" padding={1} gap={1} borderStyle={"round"}>
            <Box flexDirection="column">
                <Text bold>{event.name}</Text>
                <Text>{toDate(event.startDate)} - {event.shortLocation}</Text>
                <Link url={`https://allthingsweb.dev/${event.slug}`}>
                    <Text color={'#FF9900'}>{`https://allthingsweb.dev/${event.slug}`}</Text>
                </Link>
            </Box>

            {!hasSucceeded && <>
                <Text>To finalize registration, please enter your email address:</Text>
                <EmailInput
                    placeholder="Your email..."
                    onSubmit={async (email) => {
                        const success = await registerAction(email, event.id)
                        setHasSucceeded(success)
                        setTimeout(() => {
                            unmount()
                        }, 3000)
                    }}
                />
            </>}
        </Box>}
        {hasSucceeded && <Spinner type='fingerDance' label="Successfully registered!" />}
    </Box>
}
