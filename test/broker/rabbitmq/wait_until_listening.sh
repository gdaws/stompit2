#!/bin/bash

SECONDS=0

while [ $SECONDS -lt 60 ]
do
  if docker logs stompit2_rabbitmq_server | grep -q "started STOMP TCP listener"; then
    exit 0
  fi
  sleep 1
done

exit 1
