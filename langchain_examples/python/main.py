from langchain.chat_models import ChatOpenAI
from langchain.agents import load_tools, initialize_agent
from langchain.agents import AgentType
from langchain.tools import AIPluginTool

import os
DEV_ENV = os.environ['DEV'] == 'true'
URL = "http://localhost:3333" if DEV_ENV else "https://solana-gpt-plugin.onrender.com"

llm = ChatOpenAI(temperature=0)
tools = load_tools(["requests_post"])
tool = AIPluginTool.from_plugin_url(URL + "/.well-known/ai-plugin.json")
tools += [tool]

agent_chain = initialize_agent(
    tools, llm, agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION, verbose=True)
agent_chain.run(
    "What many lamports does 5Ef6TYJvEsNGFH7rhARyGgVutSRCWz5czfbNb7Wsyab own?")
