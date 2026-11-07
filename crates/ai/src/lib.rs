mod apps;
mod ask;
mod bridge;
mod connection;
mod error;
mod install;
mod models;
mod process;
mod providers;
mod secrets;
mod settings;
mod terminal;
mod tools;

pub use apps::{Account, AppStatus, Detected, detect};
pub use ask::{
    AskColumn, AskRequest, AskTurn, ChartKind, ChartPlan, PlanProgress, QueryPlan, plan_query,
};
pub use connection::{Connection, ConnectionRequest, connect, disconnect};
pub use error::{Error, Result};
pub use install::install_app;
pub use models::{Model, list_models};
pub use providers::{Group, Provider, find_provider, providers};
pub use secrets::{delete_key, load_key};
pub use settings::{ChosenModel, SavedConnection, Settings};
pub use terminal::open_sign_in;
pub use tools::{
    ModelEvent, ToolDefinition, ToolReply, ToolRun, Toolbox, can_use_tools, run_with_tools,
};
