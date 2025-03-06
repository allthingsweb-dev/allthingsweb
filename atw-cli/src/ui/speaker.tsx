import { Newline, Text, Box } from "ink"
import Link from "ink-link"
import { useEffect, useState } from "react"

export const FooterSpeakers = () => {
    const [speakers, setSpeakers] = useState<{
        title: string
        name: string
        link: string
    }[]>([])
    const [speakerIndex, setSpeakerIndex] = useState(0)
    useEffect(() => {
        const fetchSpeakers = async () => {
            try {
                const response = await fetch('https://allthingsweb.dev/api/speakers')
                const { data } = await response.json()
                setSpeakers(data)
            } catch (error) {
                console.error(error)
            }
        }
        fetchSpeakers()
    }, [])

    const speaker = speakers[speakerIndex]

    useEffect(() => {
        const interval = setInterval(() => {
            setSpeakerIndex((speakerIndex + 1) % speakers.length)
        }, 2000)
        return () => clearInterval(interval)
    }, [speakerIndex, speakers.length])

    if (!speaker) {
        return null
    }
    return (
        <>
            <Newline />
            <Text dimColor>------------------------  </Text>
            <Box>
                <Text italic dimColor>
                    <Text>
                        {speaker.name} - <Text color={'#FF9900'} dimColor>{speaker?.title}</Text>
                        <Newline />
                        <Link url={speaker.link}>
                            <Text color={'#FF9900'} dimColor>{speaker?.link}</Text>
                        </Link>
                    </Text>
                </Text>
            </Box>
        </>
    )
}
