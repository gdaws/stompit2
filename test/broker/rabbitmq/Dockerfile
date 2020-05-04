
ARG version=latest

FROM rabbitmq:${version}

RUN rabbitmq-plugins enable rabbitmq_management rabbitmq_stomp rabbitmq_web_stomp

EXPOSE 61613/tcp
EXPOSE 61614/tcp
EXPOSE 15672/tcp
EXPOSE 15674/tcp
