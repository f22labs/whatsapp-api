### BASE IMAGE
FROM node:18-bullseye-slim AS base

RUN apt update -y
RUN apt upgrade -y
RUN apt install -y git
RUN npm install -g npm`

### BUILD IMAGE
FROM base AS builder

WORKDIR /codechat

# (Install OS dependencies; include -dev packages if needed.)

# Install the Javascript dependencies, including all devDependencies.
COPY ./package.json .
RUN yarn

# Copy the rest of the application in and build it.
COPY . .
# RUN npm build
RUN npx tsc -p ./tsconfig.json


# Second stage: run things.
FROM node:20-alpine
RUN apk add --no-cache git
WORKDIR /codechat

COPY --from=build ./codechat/package.json .
RUN yarn

# Copy the dist tree from the first stage.
COPY --from=build ./codechat/dist .
COPY --from=build ./codechat/public ./public
COPY --from=build ./codechat/src/docs/swagger.yaml ./src/docs/
RUN mkdir instances
RUN mkdir store

# ENV DOCKER_ENV=true

# Run the built application when the container starts.
EXPOSE 8083
CMD [ "node", "./src/main.js" ]