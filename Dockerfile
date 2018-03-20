FROM node:carbon

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

# Bundle app source
COPY . .

EXPOSE 9090
CMD [ "npm", "start" ]
