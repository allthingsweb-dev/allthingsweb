
export type Event = {
    id: string
    slug: string
    name: string
    startDate: string
    location: string
}

export const registerAction = async (email: string, eventId: Event['id']) => {
    const response = await fetch(`https://allthingsweb.dev/api/events/${eventId}/register`, {
        method: 'POST',
        body: JSON.stringify({ email })
    })
    if (!response.ok) {
        throw new Error('Failed to register')
    }
    const { success } = await response.json()
    return success
}
