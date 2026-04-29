#!/bin/bash

TITLE="${1}"
TEXT="${2}"
URL="${3}"

cat <<EOF > card.json
{
  "type": "message",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "contentUrl": null,
      "content": {
        "\$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.2",
        "body": [
          {
            "type": "TextBlock",
            "text": "${TITLE}",
            "size": "Medium",
            "weight": "Bolder",
            "wrap": true
          },
          {
            "type": "TextBlock",
            "text": "${TEXT}",
            "wrap": true
          }$( [ -n "$URL" ] && cat <<URLBLOCK
,
          {
            "type": "ActionSet",
            "actions": [
              {
                "type": "Action.OpenUrl",
                "title": "View Workflow",
                "url": "${URL}"
              }
            ]
          }
URLBLOCK
)
        ]
      }
    }
  ]
}
EOF

curl -H "Content-Type: application/json" \
     -d @card.json \
     "$4"
