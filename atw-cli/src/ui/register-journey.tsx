import { Box, Text } from "ink"
import { useEffect, useState } from "react"
import { Select } from "./components/select"
import { EmailInput, Spinner } from '@inkjs/ui';

import { registerAction, type Event } from "../actions/register.action"
import Link from "ink-link";

type RegisterJourneyProps = {
    unmount: () => void
}

const toDate = (date: string) => `${new Date(date).toLocaleDateString()} ${new Date(date).toLocaleTimeString()}`

export const RegisterJourney = ({ unmount }: RegisterJourneyProps) => {
    const [events, setEvents] = useState<{
        id: string,
        slug: string,
        name: string,
        startDate: string,
        location: string
    }[]>([])

    const [event, setEvent] = useState<Event | null>(null)
    const [hasSucceeded, setHasSucceeded] = useState(false)

    useEffect(() => {
        const fetchEvents = async () => {
            try {
                const response = await fetch('https://allthingsweb.dev/api/events')
                const { data } = await response.json()
                setEvents(data)
            } catch (error) {
                console.error(error)
            }

        }
        fetchEvents()
    }, [])

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
                        <Text dimColor={!isSelected}>{toDate(event.startDate)} - {value.location}</Text>
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
                <Text>{toDate(event.startDate)} - {event.location}</Text>
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
