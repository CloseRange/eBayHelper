function createConvoDetails(convoId, isEbay, username, refrenceSku, lastMessage, lastMessageDate, lastMessageRead) {
    return {
        convoId,
        isEbay,
        username,
        refrenceSku,
        lastMessage,
        lastMessageDate,
        lastMessageRead
    };
}
function createMessageDetails(messageId, username, sentByUs, messageText, messageDate) {
    return {
        messageId,
        username,
        sentByUs,
        messageText,
        messageDate
    };
}

async function getEbayConversations(accessToken, limit = 10, offset = 0) {
    const baseUrl = process.env.EBAY_ENV === "PRODUCTION"
        ? "https://api.ebay.com"
        : "https://api.sandbox.ebay.com";

    const url =
        `${baseUrl}/commerce/message/v1/conversation` +
        `?conversation_type=FROM_MEMBERS` +
        `&limit=${limit}` +
        `&offset=${offset}`;

    const response = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        }
    });

    if (!response.ok) {
        await response.text();
        console.error("Failed to fetch eBay conversations:", response.status, response.statusText);
        return [];
    }
    const data = await response.json();
    const conversations = Array.isArray(data?.conversations) ? data.conversations : [];

    return conversations.map(convo => createConvoDetails(
        convo.conversationId,
        true,
        convo.otherPartyUsername,
        convo.reference?.referenceId || convo.refrence?.referenceId || null,
        convo.latestMessage ? convo.latestMessage.messageBody : null,
        convo.latestMessage ? convo.latestMessage.createdDate : null,
        convo.latestMessage ? convo.latestMessage.readStatus : true
    ));
}


async function getEbayMessages(accessToken, convoId, limit = 10, offset = 0) {
    const baseUrl = process.env.EBAY_ENV === "PRODUCTION"
        ? "https://api.ebay.com"
        : "https://api.sandbox.ebay.com";

    const url =
        `${baseUrl}/commerce/message/v1/conversation/${convoId}` +
        `?conversation_type=FROM_MEMBERS` +
        `&limit=${limit}` +
        `&offset=${offset}`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        await response.text();
        console.error("Failed to fetch eBay messages:", response.status, response.statusText);
        return [];
    }
    const data = await response.json();
    const messages = Array.isArray(data?.messages) ? data.messages : [];

    return messages.map(msg => createMessageDetails(
        msg.messageId,
        msg.username || msg.sender?.username || '',
        msg.sentByUs,
        msg.messageText || msg.content?.text || '',
        msg.messageDate || msg.createdDate || null
    ));
}

module.exports = {
    createConvoDetails,
    createMessageDetails,
    getEbayConversations,
    getEbayMessages,
};